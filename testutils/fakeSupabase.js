/**
 * Mini-Supabase in memoria per i test: emula il sottoinsieme di PostgREST
 * (e di GoTrue) usato dalle route, con i due comportamenti che contano davvero.
 *
 * 1. **Tetto di righe per richiesta** (`db-max-rows` = 1000): una singola
 *    risposta non supera mai 1000 righe, anche chiedendone di piu'. E' la causa
 *    del troncamento silenzioso che le route di lista devono evitare paginando
 *    (`utils/paginatedSelect.js`) e che il saldo di `utils/walletService.js`
 *    evita gia' con `.range()`. Un fake senza questo tetto renderebbe i test
 *    dell'invariante 1 incapaci di distinguere i due comportamenti.
 * 2. **`return=minimal` e' il default**: `POST`/`PATCH`/`DELETE` rispondono con
 *    corpo vuoto se il client non chiede `Prefer: return=representation`
 *    (cioe' senza un `.select()` a valle). E' documentato da PostgREST
 *    (`"No request body will be returned by default"`) e verificato sul client
 *    `@supabase/postgrest-js`: senza `.select()` `data` e' `null`, non un array.
 * 3. **Invarianti di `Wallet`** (solo con `walletInvariants: true`): il limite di 3
 *    wallet per utente e l'esattamente-un default della migrazione
 *    `004_wallet_invariants.sql`, con gli stessi errori (45001/45002/45003,
 *    `PGRST202` per la RPC assente). Sono opt-in perche' cambiano il significato di
 *    ogni scrittura sulla tabella: senza, un test sul limite di 3 non proverebbe
 *    niente (il fake accetterebbe il quarto wallet).
 *
 * Supporta: filtri `eq`/`is`, `order` multi-colonna con direzione, `offset`/
 * `limit`, `count=exact` (via header `Content-Range`), `Accept:
 * application/vnd.pgrst.object+json` (il `.single()`), insert/update/delete con
 * `return=representation`. Tutto il resto fallisce esplicitamente invece di
 * fingere: un fake che risponde "abbastanza bene" nasconde proprio i difetti
 * che questi test devono trovare.
 *
 * NON e' un database: niente transazioni, niente vincoli, niente join. E' uno
 * stub HTTP deterministico e in-process.
 */
import http from "node:http";

/** Righe massime per richiesta: il `db-max-rows` di PostgREST su questo progetto. */
export const FAKE_DB_MAX_ROWS = 1000;

/** Tabella degli invarianti emulati (migrazione `004_wallet_invariants.sql`). */
const WALLET_TABLE = "Wallet";

/**
 * Errori della 004 come li restituisce PostgREST: `code` e' lo SQLSTATE,
 * `message` il nome dell'eccezione, e lo stato HTTP e' quello che PostgREST
 * assegna a quella classe (classe 45 "user-defined" -> 400, `23505` -> 409).
 * Le route leggono `error.code`; il testo e' qui solo per fedelta'.
 */
const WALLET_ERRORS = {
  LIMIT_EXCEEDED: {
    status: 400,
    payload: { code: "45001", message: "wallet_limit_exceeded", details: null, hint: null },
  },
  DEFAULT_MISSING: {
    status: 400,
    payload: { code: "45002", message: "wallet_default_missing", details: null, hint: null },
  },
  NOT_FOUND: {
    status: 400,
    payload: { code: "45003", message: "wallet_not_found", details: null, hint: null },
  },
  DUPLICATE_DEFAULT: {
    status: 409,
    payload: {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "wallet_one_default_per_user_idx"',
      details: null,
      hint: null,
    },
  },
};

/** Parametri di query che non sono filtri di colonna. */
const RESERVED_PARAMS = new Set([
  "select",
  "order",
  "offset",
  "limit",
  "columns",
  "on_conflict",
]);

const clone = (value) => JSON.parse(JSON.stringify(value));

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

/** Filtri `col=eq.valore` / `col=is.valore` (gli unici operatori usati dalle route). */
const applyFilters = (rows, searchParams) => {
  let out = rows;

  for (const [column, raw] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(column)) continue;

    const match = /^(eq|is)\.(.*)$/.exec(raw);
    if (!match) {
      throw new Error(
        `fake supabase: operatore non supportato in "${column}=${raw}" (solo eq/is)`
      );
    }

    const [, operator, expected] = match;
    out = out.filter((row) => {
      const value = row[column];
      if (operator === "is" && expected === "null") {
        return value === null || value === undefined;
      }
      return String(value) === expected;
    });
  }

  return out;
};

/** `order=date.desc,id.desc` -> righe ordinate; senza `order` l'ordine resta quello di inserimento. */
const applyOrder = (rows, order) => {
  if (!order) return rows;

  const keys = order.split(",").map((token) => {
    const [column, direction] = token.split(".");
    return { column, ascending: direction !== "desc" };
  });

  return [...rows].sort((a, b) => {
    for (const { column, ascending } of keys) {
      const result = compare(a[column], b[column]);
      if (result !== 0) return ascending ? result : -result;
    }
    return 0;
  });
};

/**
 * Avvia il finto Supabase su una porta effimera di 127.0.0.1.
 *
 * @param {object} [options]
 * @param {Record<string, Array<object>>} [options.tables] Righe iniziali per tabella.
 * @param {Record<string, object>} [options.users] Token -> utente restituito da `/auth/v1/user`.
 * @param {Record<string, object>} [options.columnDefaults] Valori delle colonne che il DB
 *   riempie quando l'insert non le fornisce (es. `Wallet.opening_balance_cents`
 *   e' `NOT NULL DEFAULT 0`): senza di essi un insert parziale produrrebbe righe
 *   che il DB reale non produrrebbe mai.
 * @param {boolean} [options.walletInvariants] Emula i vincoli di `Wallet` della
 *   migrazione `004_wallet_invariants.sql` (limite di 3, primo wallet default,
 *   indice unico del default, promozione dopo la DELETE) e la RPC
 *   `wallet_set_default`. Default `false`: il fake non e' un database e non deve
 *   imporre vincoli a chi non li sta testando.
 * @param {Record<string, Array<string>>} [options.columns] Colonne esistenti per
 *   tabella (es. `{ Wallet: ["id", "name", "userid"] }`). Quando una tabella
 *   compare qui, un insert/update che manda una colonna assente viene rifiutato
 *   come dal PostgREST reale dopo `migrations/005_drop_wallet_balance.sql`: `400`
 *   con `code: "PGRST204"` e "Could not find the '<col>' column of '<table>' in the
 *   schema cache". Serve a rendere rosso, invece che silenzioso, il rientro di una
 *   colonna rimossa (es. `balance: 0` su `POST /wallet`). Default `{}`: nessuna
 *   tabella e' vincolata, il fake accetta qualunque colonna (non e' un database).
 * @returns {Promise<{url: string, state: object, restRequests: () => Array<object>, close: () => Promise<void>}>}
 */
export const startFakeSupabase = async ({
  tables = {},
  users = {},
  columnDefaults = {},
  walletInvariants = false,
  columns = {},
} = {}) => {
  const store = {};
  for (const [name, rows] of Object.entries(tables)) store[name] = clone(rows);

  const state = {
    /** Stato mutabile del finto database: i test ci leggono il risultato delle scritture. */
    store,
    /** Ogni richiesta ricevuta, in ordine. */
    requests: [],
    /** Tabelle su cui far fallire ogni richiesta con un errore PostgREST. */
    failingTables: new Set(),
    /** RPC che il DB non ha: la richiesta risponde `PGRST202`, come PostgREST. */
    missingRpcs: new Set(),
  };

  const sequences = new Map();

  const nextId = (table) => {
    if (!sequences.has(table)) {
      const max = (store[table] ?? []).reduce(
        (acc, row) => Math.max(acc, Number(row.id) || 0),
        0
      );
      sequences.set(table, max);
    }
    sequences.set(table, sequences.get(table) + 1);
    return sequences.get(table);
  };

  // --- Schema delle colonne (opt-in) ----------------------------------------
  // Con `columns.<tabella>` dichiarato, una scrittura su una colonna inesistente
  // fallisce come sul PostgREST reale: e' il modo in cui la 005 (drop di
  // `Wallet.balance`) diventa una regressione *visibile* e non un insert muto.

  /** Prima colonna del payload che non esiste nello schema, o `null`. */
  const unknownColumn = (table, payload) => {
    const known = columns[table];
    if (!known || !payload || typeof payload !== "object") return null;
    const allowed = new Set(known);
    return Object.keys(payload).find((key) => !allowed.has(key)) ?? null;
  };

  /** Errore di PostgREST per una colonna assente (verificato sul progetto reale). */
  const unknownColumnError = (table, column) => ({
    code: "PGRST204",
    message: `Could not find the '${column}' column of '${table}' in the schema cache`,
    details: null,
    hint: null,
  });

  // --- Invarianti di `Wallet` (migrazione 004_wallet_invariants.sql) ---------
  // Emulati solo con `walletInvariants: true`. Riproducono i meccanismi che la
  // route deve saper tradurre in HTTP: il limite di 3 per utente, il primo wallet
  // forzato a default, il default unico, la promozione dopo la DELETE e la RPC
  // `wallet_set_default`. Non emulano il caso (che la route non fa) dell'UPDATE
  // che sposta un wallet a un altro utente.

  const countWallets = (userid) =>
    (store[WALLET_TABLE] ?? []).filter((row) => row.userid === userid).length;

  /**
   * Trigger `BEFORE INSERT`: limite di 3 wallet per utente e primo wallet forzato
   * a default. **Sincrona di proposito**: fra il conteggio e il push che segue nel
   * ramo POST non c'e' nessun `await`, quindi due richieste concorrenti non
   * possono passare entrambe il controllo — e' il ruolo che nel DB ha
   * `pg_advisory_xact_lock` (`wallet_take_user_lock`). Muta `is_default` sulle
   * righe in ingresso, come fa il trigger.
   *
   * @returns {object|null} la violazione da rispondere, o `null` se l'insert passa
   */
  const walletInsertViolation = (incoming) => {
    const pending = new Map();

    for (const row of incoming) {
      const taken = countWallets(row.userid) + (pending.get(row.userid) ?? 0);

      if (taken >= 3) return WALLET_ERRORS.LIMIT_EXCEEDED;

      row.is_default = taken === 0;
      pending.set(row.userid, taken + 1);
    }

    return null;
  };

  /**
   * Indice unico parziale (23505) e constraint trigger differito (45002) su un
   * UPDATE: la violazione e' calcolata sullo stato che l'UPDATE generico
   * produrrebbe, non su quello corrente.
   */
  const walletUpdateViolation = (matched, body) => {
    const after = (store[WALLET_TABLE] ?? []).map((row) =>
      matched.includes(row) ? { ...row, ...body, id: row.id } : row
    );

    for (const row of matched) {
      const updated = { ...row, ...body };
      if (!updated.is_default) continue;

      const otherDefault = after.some(
        (other) =>
          other.userid === updated.userid &&
          other.is_default &&
          other.id !== row.id
      );
      if (otherDefault) return WALLET_ERRORS.DUPLICATE_DEFAULT;
    }

    for (const userid of new Set(after.map((row) => row.userid))) {
      const owned = after.filter((row) => row.userid === userid);
      if (owned.length > 0 && owned.filter((row) => row.is_default).length !== 1)
        return WALLET_ERRORS.DEFAULT_MISSING;
    }

    return null;
  };

  /** Trigger `AFTER DELETE`: eliminando il default ne promuove un altro. */
  const walletPromoteDefault = (removed) => {
    for (const row of removed) {
      if (!row.is_default) continue;

      const owned = (store[WALLET_TABLE] ?? [])
        .filter((other) => other.userid === row.userid)
        .sort((a, b) => Number(a.id) - Number(b.id));

      if (owned.length > 0 && !owned.some((other) => other.is_default))
        owned[0].is_default = true;
    }
  };

  /**
   * RPC `wallet_set_default(p_userid uuid, p_wallet_id integer)`: azzera gli altri
   * default dell'utente e setta quello richiesto in una sola operazione; `45003`
   * (senza cambiare nulla) se il wallet non esiste o non e' dell'utente.
   */
  const walletSetDefaultRpc = (args, json) => {
    const wallets = store[WALLET_TABLE] ?? [];
    const target = wallets.find(
      (row) =>
        String(row.id) === String(args?.p_wallet_id) &&
        row.userid === args?.p_userid
    );

    if (!target) return json(400, WALLET_ERRORS.NOT_FOUND.payload);

    for (const row of wallets) {
      if (row.userid === target.userid && row !== target) row.is_default = false;
    }
    target.is_default = true;

    return json(200, [clone(target)]);
  };

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));

    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const body = raw ? JSON.parse(raw) : null;

      state.requests.push({
        method: req.method,
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
        search: url.search,
        accept: req.headers.accept ?? null,
        prefer: req.headers.prefer ?? null,
        authorization: req.headers.authorization ?? null,
        // Clonato: e' uno snapshot della richiesta. Gli invarianti di `Wallet`,
        // quando attivi, mutano le righe in ingresso (e' cio' che fa il trigger
        // BEFORE INSERT sul valore che il client ha mandato): il payload registrato
        // deve restare quello che il client ha inviato.
        body: clone(body),
      });

      const json = (status, payload, headers = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };

      // `return=minimal` (default): nessun corpo, come PostgREST.
      const noContent = (status) => {
        res.writeHead(status);
        res.end();
      };

      const accept = req.headers.accept ?? "";
      const prefer = req.headers.prefer ?? "";
      const wantsObject = accept.includes("application/vnd.pgrst.object+json");
      const wantsRepresentation = prefer.includes("return=representation");

      const singleObjectError = (status, count) =>
        json(status, {
          code: "PGRST116",
          details: `Results contain ${count} rows, application/vnd.pgrst.object+json requires 1 row`,
          hint: null,
          message: "JSON object requested, multiple (or no) rows returned",
        });

      // --- GoTrue (auth) ---------------------------------------------------
      if (url.pathname === "/auth/v1/user") {
        const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        if (!token || !users[token]) return json(401, { message: "invalid token" });
        return json(200, users[token]);
      }

      // --- PostgREST -------------------------------------------------------
      if (!url.pathname.startsWith("/rest/v1/")) {
        return json(404, { message: "not found" });
      }

      const table = url.pathname.slice("/rest/v1/".length);

      // --- Funzioni RPC (POST /rest/v1/rpc/<nome>) --------------------------
      if (table.startsWith("rpc/")) {
        const fn = table.slice("rpc/".length);

        if (
          fn === "wallet_set_default" &&
          walletInvariants &&
          !state.missingRpcs.has(fn)
        ) {
          return walletSetDefaultRpc(body, json);
        }

        // Funzione assente: e' la risposta di PostgREST quando la migrazione 004
        // non e' applicata, e per qualsiasi RPC non emulata.
        return json(404, {
          code: "PGRST202",
          message: `Could not find the function public.${fn} in the schema cache`,
          details: `Searched for the function public.${fn}.`,
          hint: null,
        });
      }

      if (state.failingTables.has(table)) {
        return json(500, {
          message: "boom",
          code: "PGRST000",
          details: null,
          hint: null,
        });
      }

      if (!store[table]) store[table] = [];

      const rows = store[table];
      const matched = applyFilters(rows, url.searchParams);

      if (req.method === "GET") {
        const ordered = applyOrder(matched, url.searchParams.get("order"));
        const total = ordered.length;
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limitParam = url.searchParams.get("limit");
        const requested = limitParam === null ? total : Number(limitParam);
        const size = Math.max(
          0,
          Math.min(requested, FAKE_DB_MAX_ROWS, total - offset)
        );
        const page = ordered.slice(offset, offset + size);
        const contentRange =
          size === 0 ? `*/${total}` : `${offset}-${offset + size - 1}/${total}`;

        if (wantsObject) {
          if (page.length !== 1) return singleObjectError(406, page.length);
          return json(200, page[0], { "Content-Range": contentRange });
        }
        return json(200, page, { "Content-Range": contentRange });
      }

      if (req.method === "POST") {
        const incoming = Array.isArray(body) ? body : [body];

        const unknown = incoming
          .map((row) => unknownColumn(table, row))
          .find(Boolean);
        if (unknown) return json(400, unknownColumnError(table, unknown));

        if (walletInvariants && table === WALLET_TABLE) {
          const violation = walletInsertViolation(incoming);
          if (violation) return json(violation.status, violation.payload);
        }

        const defaults = columnDefaults[table] ?? {};
        const inserted = incoming.map((row) => ({
          ...defaults,
          id: row.id ?? nextId(table),
          ...row,
        }));
        rows.push(...inserted);

        if (!wantsRepresentation) return noContent(201);
        if (wantsObject) return json(201, inserted[0] ?? null);
        return json(201, inserted);
      }

      if (req.method === "PATCH") {
        const unknown = unknownColumn(table, body);
        if (unknown) return json(400, unknownColumnError(table, unknown));

        if (walletInvariants && table === WALLET_TABLE) {
          const violation = walletUpdateViolation(matched, body);
          if (violation) return json(violation.status, violation.payload);
        }

        const updated = matched.map((row) => Object.assign(row, body));

        if (!wantsRepresentation) return noContent(204);
        if (wantsObject) {
          if (updated.length !== 1) return singleObjectError(406, updated.length);
          return json(200, updated[0]);
        }
        return json(200, updated);
      }

      if (req.method === "DELETE") {
        const removed = matched;
        store[table] = rows.filter((row) => !removed.includes(row));

        if (walletInvariants && table === WALLET_TABLE)
          walletPromoteDefault(removed);

        if (!wantsRepresentation) return noContent(204);
        if (wantsObject) {
          if (removed.length !== 1) return singleObjectError(406, removed.length);
          return json(200, removed[0]);
        }
        return json(200, removed);
      }

      return json(405, { message: `method ${req.method} not supported by the fake` });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url,
    state,
    /** Solo le richieste a `/rest/v1/<tabella>` (le query, senza l'auth). */
    restRequests: () =>
      state.requests.filter((request) => request.path.startsWith("/rest/v1/")),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
