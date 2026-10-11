/**
 * Test dei due endpoint di lista della workstream di paginazione:
 *   GET /transaction/all      (routes/transaction.js)
 *   GET /bank/transactions    (routes/bank.js -> utils/bankService.js)
 *
 * Sono test **end-to-end** sulla vera catena HTTP: vera app Express, vero router,
 * vero `requireAuth`, vero client `@supabase/supabase-js`. L'unica cosa finta e' il
 * server Supabase, sostituito da un PostgREST minimale su 127.0.0.1 che emula due
 * comportamenti del progetto reale:
 *
 *   1. il tetto di righe per richiesta (`db-max-rows` = 1000): anche chiedendone di
 *      piu', una singola risposta non supera 1000 righe. E' la causa del troncamento
 *      silenzioso che questi endpoint devono eliminare.
 *   2. l'header `Content-Range: from-to/total`, da cui `supabase-js` ricava `count`.
 *
 * Il dataset e' generato al volo dal conteggio, quindi i casi > 100k righe non
 * allocano nulla.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// ---------------------------------------------------------------------------
// Finto Supabase (PostgREST + endpoint auth)
// ---------------------------------------------------------------------------

/** Tetto per richiesta: il `db-max-rows` di PostgREST su questo progetto. */
const FAKE_DB_MAX_ROWS = 1000;

const USER = { id: "user-1", email: "user@example.com" };
const VALID_TOKEN = "test-token";

const buildRow = (table, index) =>
  table === "Transaction"
    ? {
        id: index,
        userid: USER.id,
        description: `txn ${index}`,
        amount: 1,
        date: "2026-01-01",
        type: "E",
      }
    : {
        id: index,
        user_id: USER.id,
        bank_id: "BANK_X",
        account_id: "acc_1",
        external_id: `ext_${index}`,
        amount: 1,
        currency: "EUR",
        description: `bank txn ${index}`,
        date: "2026-01-01",
        counterparty: "Shop",
        status: "synced",
      };

/**
 * Avvia il finto Supabase. `state.counts` e' modificabile dai test: il dataset di
 * ogni tabella e' `1..counts[table]`.
 */
const startFakeSupabase = async () => {
  const state = {
    counts: { Transaction: 0, bank_transactions: 0 },
    failingTables: new Set(),
    requests: [],
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push({
      path: url.pathname,
      search: url.search,
      params: Object.fromEntries(url.searchParams),
      authorization: req.headers.authorization ?? null,
    });

    const json = (status, body, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/auth/v1/user") {
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (token !== VALID_TOKEN) {
        return json(401, { message: "invalid token" });
      }
      return json(200, USER);
    }

    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    if (state.failingTables.has(table)) {
      return json(500, {
        message: "boom",
        code: "PGRST000",
        details: null,
        hint: null,
      });
    }

    const total = state.counts[table] ?? 0;
    const from = Number(url.searchParams.get("offset") ?? 0);
    // PostgREST non restituisce mai piu' di `db-max-rows` righe, comunque sia `limit`.
    const requested = Number(url.searchParams.get("limit") ?? total);
    const size = Math.max(0, Math.min(requested, FAKE_DB_MAX_ROWS, total - from));
    const rows = Array.from({ length: size }, (_, i) => buildRow(table, from + i + 1));

    if (size === 0) {
      return json(200, [], { "Content-Range": `*/${total}` });
    }
    return json(200, rows, {
      "Content-Range": `${from}-${from + size - 1}/${total}`,
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const fake = await startFakeSupabase();

// L'env va impostato PRIMA dell'import: `config/supabaseClient.js`,
// `utils/bankService.js` e `utils/bankSyncScheduler.js` costruiscono il client
// all'import. `dotenv` (chiamato li' dentro) non sovrascrive variabili gia' presenti.
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.BANK_MOCK_ENABLED = "false";

const express = (await import("express")).default;
const transactionRouter = (await import("./transaction.js")).default;
const bankRouter = (await import("./bank.js")).default;

const app = express();
app.use("/transaction", transactionRouter);
app.use("/bank", bankRouter);
// Stesso error handler globale di server.js.
app.use((err, req, res, next) => {
  void next;
  res.status(500).json({ error: "Internal Server Error" });
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  return fake.close();
});

/** Richiesta autenticata all'app di test. */
const get = async (path, { token = VALID_TOKEN } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: await response.json() };
};

/** Azzera il registro delle richieste viste dal finto PostgREST. */
const watch = () => {
  fake.state.requests.length = 0;
  return () => fake.state.requests.filter((r) => r.path.startsWith("/rest/v1/"));
};

const resetFake = () => {
  fake.state.counts = { Transaction: 0, bank_transactions: 0 };
  fake.state.failingTables = new Set();
};

// ---------------------------------------------------------------------------
// GET /transaction/all
// ---------------------------------------------------------------------------

test("GET /transaction/all: 1314 righe utente tornano tutte, truncated false", async () => {
  resetFake();
  fake.state.counts.Transaction = 1314;
  const seen = watch();

  const { status, body } = await get("/transaction/all");

  assert.equal(status, 200);
  assert.equal(body.data.length, 1314, "nessuna riga deve sparire oltre il tetto di 1000");
  assert.equal(body.count, 1314);
  assert.equal(body.total, 1314);
  assert.equal(body.truncated, false);

  // Ordine deterministico: pagine consecutive senza duplicati ne' buchi.
  // Il finto PostgREST restituisce il dataset nell'ordine richiesto dalla query
  // (`order` e' verificato piu' sotto), quindi qui la sequenza concatenata e' 1..1314.
  const ids = body.data.map((row) => row.id);
  assert.equal(new Set(ids).size, 1314, "id duplicati tra le pagine");
  assert.deepEqual(
    ids,
    Array.from({ length: 1314 }, (_, i) => i + 1),
    "le pagine devono concatenarsi senza duplicati ne' righe saltate"
  );

  // Il filtro per utente e' rimasto nella query, e la paginazione e' reale.
  const queries = seen();
  assert.ok(queries.length >= 2, "servono piu' richieste per superare il tetto di 1000");
  for (const request of queries) {
    assert.equal(request.params.userid, `eq.${USER.id}`);
    assert.equal(request.params.order, "date.desc,id.desc");
  }
  assert.equal(queries[0].params.offset, "0");
  assert.equal(queries[1].params.offset, "1000");
});

test("il tetto one-shot (1000 righe) e' quello che l'endpoint ora evita", async () => {
  resetFake();
  fake.state.counts.Transaction = 1314;

  // Stessa query dell'endpoint ma senza .range(): e' il comportamento pregresso.
  const { supabase } = await import("../config/supabaseClient.js");
  const { data } = await supabase
    .from("Transaction")
    .select("*")
    .eq("userid", USER.id)
    .order("date", { ascending: false });

  assert.equal(data.length, FAKE_DB_MAX_ROWS, "il finto PostgREST replica il tetto reale");
  assert.ok(data.length < 1314, "una select() una-shot non vede tutte le righe");
});

test("GET /transaction/all: 1001 righe (appena oltre il tetto) tornano tutte", async () => {
  resetFake();
  fake.state.counts.Transaction = 1001;

  const { status, body } = await get("/transaction/all");

  assert.equal(status, 200);
  assert.equal(body.data.length, 1001);
  assert.equal(body.count, 1001);
  assert.equal(body.total, 1001);
  assert.equal(body.truncated, false);
  assert.equal(new Set(body.data.map((r) => r.id)).size, 1001);
});

test("GET /transaction/all: oltre maxPages dichiara truncated true", async () => {
  resetFake();
  // 100 pagine da 1000 righe e' il tetto di sicurezza dell'helper; il dataset lo supera.
  fake.state.counts.Transaction = 100_500;

  const { status, body } = await get("/transaction/all");

  assert.equal(status, 200);
  assert.equal(body.data.length, 100_000);
  assert.equal(body.count, 100_000);
  assert.equal(body.total, 100_500, "il totale del range resta quello dichiarato dal DB");
  assert.equal(body.truncated, true, "un set incompleto va dichiarato, mai taciuto");
});

test("GET /transaction/all: set vuoto, il campo truncated c'e' comunque", async () => {
  resetFake();

  const { status, body } = await get("/transaction/all");

  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.count, 0);
  assert.equal(body.total, 0);
  assert.equal(Object.hasOwn(body, "truncated"), true);
  assert.equal(body.truncated, false);
});

test("GET /transaction/all: errore PostgREST -> 400 con il messaggio, nessuna lista parziale", async () => {
  resetFake();
  fake.state.counts.Transaction = 2500;
  fake.state.failingTables.add("Transaction");

  const { status, body } = await get("/transaction/all");

  assert.equal(status, 400);
  assert.equal(body.error, "boom");
  assert.equal(body.data, undefined, "un errore non deve restituire un payload di lista");
});

// ---------------------------------------------------------------------------
// GET /bank/transactions
// ---------------------------------------------------------------------------

test("GET /bank/transactions: mantiene la chiave transactions e pagina oltre 1000", async () => {
  resetFake();
  fake.state.counts.bank_transactions = 1500;
  const seen = watch();

  const { status, body } = await get("/bank/transactions?bank=BANK_X");

  assert.equal(status, 200);
  assert.equal(body.transactions.length, 1500);
  assert.equal(body.count, 1500);
  assert.equal(body.total, 1500);
  assert.equal(body.truncated, false);
  assert.equal(
    new Set(body.transactions.map((row) => row.id)).size,
    1500,
    "nessun id duplicato tra le pagine"
  );

  const queries = seen();
  assert.ok(queries.length >= 2);
  for (const request of queries) {
    assert.equal(request.params.user_id, `eq.${USER.id}`);
    assert.equal(request.params.bank_id, "eq.BANK_X");
    assert.equal(request.params.order, "date.desc,id.desc");
  }
});

test("GET /bank/transactions: i filtri di data restano applicati, bank=all non filtra la banca", async () => {
  resetFake();
  fake.state.counts.bank_transactions = 3;
  const seen = watch();

  const { status, body } = await get(
    "/bank/transactions?bank=all&startDate=2026-01-01&endDate=2026-01-31"
  );

  assert.equal(status, 200);
  assert.equal(body.transactions.length, 3);
  assert.equal(body.truncated, false);

  const [request] = seen();
  assert.equal(request.params.bank_id, undefined, "bank=all non deve filtrare per banca");
  assert.deepEqual(
    new URLSearchParams(request.search).getAll("date"),
    ["gte.2026-01-01", "lte.2026-01-31"],
    "entrambi i bordi del range di date devono restare nella query"
  );
  assert.equal(request.params.offset, "0");
  assert.equal(request.params.limit, "1000");
});

test("GET /bank/transactions: oltre maxPages dichiara truncated true", async () => {
  resetFake();
  fake.state.counts.bank_transactions = 100_500;

  const { status, body } = await get("/bank/transactions");

  assert.equal(status, 200);
  assert.equal(body.transactions.length, 100_000);
  assert.equal(body.count, 100_000);
  assert.equal(body.total, 100_500);
  assert.equal(body.truncated, true);
});

// ---------------------------------------------------------------------------
// Autenticazione (nessuna regressione: i due endpoint restano protetti)
// ---------------------------------------------------------------------------

test("senza token valido i due endpoint rispondono 401", async () => {
  resetFake();
  fake.state.counts.Transaction = 10;

  assert.equal((await get("/transaction/all", { token: null })).status, 401);
  assert.equal((await get("/transaction/all", { token: "nope" })).status, 401);
  assert.equal((await get("/bank/transactions", { token: null })).status, 401);
});
