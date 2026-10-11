/**
 * Invariante 1 — il saldo di un wallet e' **la somma di tutte le sue transazioni**,
 * anche quando il set supera il tetto PostgREST di 1000 righe (il bug di T4.1).
 * Invariante 2 — massimo 3 wallet per utente ed **esattamente un `is_default`**.
 *
 * Sono test end-to-end sulla catena vera: app Express, router vero, `requireAuth`
 * vero, client `@supabase/supabase-js` vero. L'unica cosa finta e' il server
 * Supabase (`testutils/fakeSupabase.js`), che replica il tetto di 1000 righe per
 * richiesta e il default `return=minimal` di PostgREST.
 *
 * Il tetto e' cio' che rende l'invariante 1 non banale: senza paginazione la
 * somma si ferma alle prime 1000 righe **senza errore**. Il primo test fissa il
 * valore atteso con un'aritmetica indipendente dal codice di produzione.
 *
 * L'invariante 2 non e' piu' un controllo applicativo: dal task del DB (migrazione
 * `004_wallet_invariants.sql`) il limite di 3 wallet e l'esattamente-un default sono
 * vincoli del database, che il fake riproduce (`walletInvariants: true`). Questa
 * suite verifica quindi il contratto della route con quei vincoli: nessun conteggio
 * preventivo, l'errore del DB tradotto in 409/404, e l'invariante che resta vero
 * dopo ogni scrittura.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";
const TOKEN2 = "token-user-2";

const fake = await startFakeSupabase({
  users: {
    [TOKEN1]: { id: U1, email: "user1@example.com" },
    [TOKEN2]: { id: U2, email: "user2@example.com" },
  },
  tables: { Wallet: [], Transaction: [] },
  // Colonne che nel DB hanno un default e che la route non manda piu':
  // `opening_balance_cents` e' NOT NULL DEFAULT 0 (migrazione 003), `is_default`
  // DEFAULT false.
  columnDefaults: { Wallet: { opening_balance_cents: 0, is_default: false } },
  // Gli invarianti di `Wallet` (limite di 3, primo wallet default, default unico)
  // sono del DB (migrazione 004): il fake li emula, cosi' questa suite verifica che
  // la route *traduca* il vincolo in HTTP, non un controllo applicativo che non
  // esiste piu'.
  walletInvariants: true,
});

// L'env va impostato PRIMA dell'import: `config/supabaseClient.js` costruisce il
// client all'import (e `dotenv` non sovrascrive variabili gia' presenti).
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const walletRouter = (await import("./wallet.js")).default;

const app = express();
app.use(express.json());
app.use("/wallet", walletRouter);
// Stesso error handler globale di server.js: un handler che lancia risponde 500.
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

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const request = async (method, path, { token = TOKEN1, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const reset = ({ wallets = [], transactions = [] } = {}) => {
  fake.state.store.Wallet = wallets;
  fake.state.store.Transaction = transactions;
  fake.state.requests.length = 0;
};

/** Azzera il registro delle richieste e restituisce un lettore di quelle PostgREST. */
const watch = () => {
  fake.state.requests.length = 0;
  return () => fake.restRequests();
};

/** Righe di movimento con id sequenziale: la somma ordina per id, l'ordine deve essere totale. */
const movements = ({ userId, walletId, type, amount, count, startId }) =>
  Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    userid: userId,
    wallet_id: walletId,
    description: `${type} ${i}`,
    amount,
    type,
    date: "2026-01-01",
  }));

/**
 * Saldo atteso in unita' (non centesimi), calcolato qui e non dal modulo in prova:
 * apertura + somma firmata dei movimenti, arrotondata al centesimo.
 */
const expectedBalance = (openingCents, rows) => {
  const cents =
    openingCents +
    rows.reduce(
      (acc, row) => acc + (row.type === "I" ? 1 : -1) * Math.round(row.amount * 100),
      0
    );
  return Number((cents / 100).toFixed(2));
};

const wallet = (id, userId, name, { isDefault = false, opening = 0 } = {}) => ({
  id,
  userid: userId,
  name,
  is_default: isDefault,
  opening_balance_cents: opening,
  balance: 0,
});

/** Numero di wallet di default dell'utente, letto dallo stato del finto DB. */
const defaultCount = (userId) =>
  fake.state.store.Wallet.filter((w) => w.userid === userId && w.is_default).length;

const walletCount = (userId) =>
  fake.state.store.Wallet.filter((w) => w.userid === userId).length;

/** Id dei wallet di default dell'utente, nell'ordine della tabella. */
const defaultIds = (userId) =>
  fake.state.store.Wallet.filter((w) => w.userid === userId && w.is_default).map(
    (w) => w.id
  );

// ---------------------------------------------------------------------------
// Invariante 1 — saldo == somma delle transazioni oltre le 1000 righe
// ---------------------------------------------------------------------------

test("invariante 1: il saldo somma TUTTE le transazioni, oltre il tetto di 1000 righe", async () => {
  const rows = movements({
    userId: U1,
    walletId: 7,
    type: "I",
    amount: 1,
    count: 1500,
    startId: 1,
  });
  reset({
    wallets: [wallet(7, U1, "Main", { isDefault: true, opening: 2500 })],
    transactions: rows,
  });
  const seen = watch();

  const { status, body } = await request("GET", "/wallet");

  assert.equal(status, 200);
  assert.equal(body.length, 1);

  const [main] = body;
  assert.equal(main.opening_balance_cents, 2500);
  assert.equal(main.balance, expectedBalance(2500, rows));
  assert.equal(main.balance, 1525, "25.00 di apertura + 1500 movimenti da 1.00");

  // La lettura ha davvero superato il tetto: almeno due pagine, con offset
  // consecutivi e sempre filtrate per l'utente del token.
  const reads = seen().filter((request) => request.path === "/rest/v1/Transaction");
  assert.ok(reads.length >= 2, "servono piu' pagine per superare il tetto di 1000");
  assert.equal(reads[0].params.offset, "0");
  assert.equal(reads[1].params.offset, "1000");
  for (const read of reads) {
    assert.equal(read.params.userid, `eq.${U1}`);
    assert.equal(read.params.order, "id.asc");
  }
});

test("invariante 1: il tetto di 1000 righe e' reale (la select una-shot si tronca)", async () => {
  const rows = movements({
    userId: U1,
    walletId: 7,
    type: "I",
    amount: 1,
    count: 1500,
    startId: 1,
  });
  reset({
    wallets: [wallet(7, U1, "Main", { isDefault: true, opening: 0 })],
    transactions: rows,
  });

  // La stessa lettura senza `.range()`: e' il comportamento pregresso del saldo.
  const { supabase } = await import("../config/supabaseClient.js");
  const { data } = await supabase
    .from("Transaction")
    .select("*")
    .eq("userid", U1)
    .order("id", { ascending: true });

  assert.equal(data.length, 1000, "il finto PostgREST replica il tetto reale");
  assert.ok(
    data.length < rows.length,
    "una select una-shot non vede le righe oltre il tetto: senza paginazione il saldo e' sbagliato"
  );
});

test("invariante 1: 1001 righe (appena oltre il tetto), la riga di troppo entra nella somma", async () => {
  const rows = movements({
    userId: U1,
    walletId: 7,
    type: "I",
    amount: 2,
    count: 1001,
    startId: 1,
  });
  reset({
    wallets: [wallet(7, U1, "Main", { isDefault: true, opening: 0 })],
    transactions: rows,
  });

  const { status, body } = await request("GET", "/wallet");

  assert.equal(status, 200);
  assert.equal(body[0].balance, expectedBalance(0, rows));
  assert.equal(body[0].balance, 2002);
});

test("invariante 1: la somma considera solo le transazioni dell'utente del token", async () => {
  reset({
    wallets: [wallet(7, U1, "Main", { isDefault: true, opening: 0 })],
    transactions: [
      ...movements({ userId: U1, walletId: 7, type: "I", amount: 1, count: 10, startId: 1 }),
      // Anomalia voluta: movimenti di un altro utente sullo stesso wallet_id.
      // Il filtro per `userid` li deve escludere dalla somma.
      ...movements({ userId: U2, walletId: 7, type: "I", amount: 99, count: 40, startId: 1000 }),
    ],
  });

  const { status, body } = await request("GET", "/wallet");

  assert.equal(status, 200);
  assert.equal(body[0].balance, 10, "solo i 10 movimenti dell'utente autenticato");
});

test("invariante 1: nessun wallet -> lista vuota, nessuna somma inventata", async () => {
  reset({ transactions: [] });

  const { status, body } = await request("GET", "/wallet");

  assert.equal(status, 200);
  assert.deepEqual(body, []);
});

// ---------------------------------------------------------------------------
// Invariante 2 — max 3 wallet per utente, esattamente un default
// ---------------------------------------------------------------------------

test("invariante 2: il quarto wallet e' respinto dal DB, senza alcun count preventivo", async () => {
  reset({
    wallets: [
      wallet(1, U1, "Uno", { isDefault: true }),
      wallet(2, U1, "Due"),
      wallet(3, U1, "Tre"),
    ],
  });
  const seen = watch();

  const { status, body } = await request("POST", "/wallet", { body: { name: "Quarto" } });

  assert.equal(status, 409, "il conflitto con lo stato e' un 409, non un 400 della route");
  assert.match(body.error, /Max 3 wallets/);
  assert.ok(
    !/45001|wallet_limit_exceeded|duplicate key/.test(JSON.stringify(body)),
    "il testo interno del DB non finisce nella risposta"
  );

  const walletRequests = seen().filter(
    (request) => request.path === "/rest/v1/Wallet"
  );
  assert.deepEqual(
    walletRequests.map((request) => request.method),
    ["POST"],
    "la route tenta direttamente l'insert: nessun conteggio e nessuna lettura di compensazione"
  );
  assert.equal(
    walletRequests.some((request) => /count=/.test(request.search)),
    false,
    "nessuna query di conteggio: il limite e' un invariante del DB"
  );

  assert.equal(walletCount(U1), 3, "nessun wallet e' stato creato");
  assert.equal(defaultCount(U1), 1);
});

test("invariante 2: il primo wallet nasce default, i successivi no", async () => {
  reset();

  const first = await request("POST", "/wallet", { body: { name: "Primo" } });
  assert.equal(first.status, 201);
  assert.equal(first.body.name, "Primo");
  assert.equal(first.body.userid, U1, "il proprietario viene dal token");
  assert.equal(first.body.is_default, true, "il primo wallet e' il default");
  assert.equal(walletCount(U1), 1);
  assert.equal(defaultCount(U1), 1);

  const second = await request("POST", "/wallet", { body: { name: "Secondo" } });
  assert.equal(second.status, 201);
  assert.equal(second.body.is_default, false, "un wallet nuovo non e' default");
  assert.equal(walletCount(U1), 2);
  assert.equal(defaultCount(U1), 1, "esattamente un default anche dopo il secondo wallet");
});

test("invariante 2: il cambio di default ne lascia esattamente uno e azzera gli altri", async () => {
  reset({
    wallets: [
      wallet(1, U1, "Uno", { isDefault: true }),
      wallet(2, U1, "Due"),
      wallet(3, U1, "Tre"),
    ],
  });

  const { status, body } = await request("PUT", "/wallet/2", {
    body: { is_default: true },
  });

  assert.equal(status, 200);
  assert.equal(body.id, 2);
  assert.equal(body.is_default, true);

  assert.equal(defaultCount(U1), 1, "un solo default dopo il cambio");
  assert.deepEqual(
    fake.state.store.Wallet.filter((w) => w.userid === U1 && w.is_default).map((w) => w.id),
    [2]
  );
});

test("invariante 2: il limite e' per utente, i wallet altrui non contano", async () => {
  reset({
    wallets: [
      wallet(1, U1, "Uno", { isDefault: true }),
      wallet(2, U1, "Due"),
      wallet(3, U1, "Tre"),
    ],
  });

  const { status, body } = await request("POST", "/wallet", {
    token: TOKEN2,
    body: { name: "Mio" },
  });

  assert.equal(status, 201);
  assert.equal(body.userid, U2);
  assert.equal(body.is_default, true, "e' il primo wallet dell'altro utente");
  assert.equal(walletCount(U2), 1);
  assert.equal(walletCount(U1), 3, "i wallet del primo utente restano intatti");
  assert.equal(defaultCount(U2), 1);
  assert.equal(defaultCount(U1), 1);
});

test("invariante 2: dopo ogni scrittura, per ogni utente con wallet, il default e' esattamente uno", async () => {
  reset({
    wallets: [
      wallet(1, U1, "Uno", { isDefault: true }),
      wallet(2, U1, "Due"),
      wallet(3, U2, "Altro", { isDefault: true }),
    ],
  });

  const steps = [
    () => request("POST", "/wallet", { body: { name: "Tre" } }),
    () => request("POST", "/wallet", { body: { name: "Quarto" } }),
    () => request("PUT", "/wallet/1", { body: { is_default: true } }),
    () => request("PUT", "/wallet/2", { body: { is_default: true } }),
    () => request("PUT", "/wallet/1", { body: { name: "Rinominato" } }),
  ];

  for (const step of steps) {
    await step();
    for (const userId of [U1, U2]) {
      if (walletCount(userId) > 0) {
        assert.equal(
          defaultCount(userId),
          1,
          `utente ${userId}: ${defaultCount(userId)} default dopo ${walletCount(U1)}/${walletCount(U2)} wallet`
        );
      }
      assert.ok(walletCount(userId) <= 3, `utente ${userId}: superato il limite di 3 wallet`);
    }
  }
});

// ---------------------------------------------------------------------------
// Contratto della route con i vincoli del DB: quarto wallet, concorrenza,
// cambio di default come singola operazione, errori del DB tradotti in HTTP
// ---------------------------------------------------------------------------

test("contratto: il POST non manda is_default — il primo wallet e' default per il DB", async () => {
  reset();
  const seen = watch();

  const { status, body } = await request("POST", "/wallet", { body: { name: "Primo" } });

  assert.equal(status, 201);
  assert.equal(body.is_default, true, "il default lo decide il DB, non la route");

  const insert = seen().find(
    (request) => request.path === "/rest/v1/Wallet" && request.method === "POST"
  );
  assert.deepEqual(
    insert.body,
    [{ name: "Primo", userid: U1 }],
    "nessun is_default nel payload: e' il trigger BEFORE INSERT a deciderlo"
  );
  assert.equal(defaultCount(U1), 1);
});

test("contratto: otto POST concorrenti su due wallet esistenti ne creano uno solo", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });

  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      request("POST", "/wallet", { body: { name: `Concorrente ${i}` } })
    )
  );

  assert.equal(
    responses.filter((response) => response.status === 201).length,
    1,
    "partendo da 2 wallet un solo POST puo' riuscire"
  );
  assert.equal(
    responses.filter((response) => response.status === 409).length,
    7,
    "gli altri sette trovano il limite del DB"
  );
  assert.equal(walletCount(U1), 3, "il limite di 3 regge anche sotto concorrenza");
  assert.equal(defaultCount(U1), 1);
});

test("contratto: il cambio di default e' una sola richiesta (RPC), non due UPDATE", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });
  const seen = watch();

  const { status, body } = await request("PUT", "/wallet/2", {
    body: { is_default: true },
  });

  assert.equal(status, 200);
  assert.equal(body.id, 2);
  assert.equal(body.is_default, true);

  const writes = seen().filter((request) => request.method !== "GET");
  assert.equal(writes.length, 1, "una sola scrittura: la RPC");
  assert.equal(writes[0].path, "/rest/v1/rpc/wallet_set_default");
  assert.deepEqual(writes[0].body, { p_userid: U1, p_wallet_id: 2 });

  assert.deepEqual(defaultIds(U1), [2], "il default e' esattamente quello richiesto");
});

test("contratto: la RPC fallita (wallet inesistente o altrui) non cambia il default", async () => {
  reset({
    wallets: [
      wallet(1, U1, "Uno", { isDefault: true }),
      wallet(2, U1, "Due"),
      wallet(50, U2, "Altro", { isDefault: true }),
    ],
  });

  const missing = await request("PUT", "/wallet/999", { body: { is_default: true } });
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /Wallet not found/);
  assert.ok(
    !/45003|wallet_not_found/.test(JSON.stringify(missing.body)),
    "nessun dettaglio interno del DB"
  );

  const foreign = await request("PUT", "/wallet/50", { body: { is_default: true } });
  assert.equal(foreign.status, 404, "il wallet di un altro utente non e' assegnabile");

  const notANumber = await request("PUT", "/wallet/abc", {
    body: { is_default: true },
  });
  assert.equal(notANumber.status, 404, "un id non numerico e' un wallet che non esiste");

  assert.deepEqual(defaultIds(U1), [1], "il default precedente e' intatto");
  assert.deepEqual(defaultIds(U2), [50]);
});

test("contratto: con la migrazione non applicata (RPC assente) risponde 503 senza toccare nulla", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });

  fake.state.missingRpcs.add("wallet_set_default");
  try {
    const { status, body } = await request("PUT", "/wallet/2", {
      body: { is_default: true },
    });
    assert.equal(status, 503, "guasto di ambiente, non errore di richiesta");
    assert.match(body.error, /004_wallet_invariants/, "l'errore dice quale migrazione manca");
  } finally {
    fake.state.missingRpcs.delete("wallet_set_default");
  }

  assert.deepEqual(defaultIds(U1), [1], "nessun cambio parziale");
});

test("contratto: spegnere l'unico default e' un 409, e il default resta", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });

  const { status, body } = await request("PUT", "/wallet/1", {
    body: { is_default: false },
  });

  assert.equal(status, 409);
  assert.ok(!/45002|wallet_default_missing/.test(JSON.stringify(body)));
  assert.deepEqual(defaultIds(U1), [1], "l'utente non resta senza default");
});

test("contratto: eliminare il wallet di default promuove l'altro", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });

  const { status } = await request("DELETE", "/wallet/1");

  assert.equal(status, 200);
  assert.equal(walletCount(U1), 1);
  assert.deepEqual(defaultIds(U1), [2], "il DB promuove un nuovo default");
});

test("contratto: default e nome insieme restano coerenti", async () => {
  reset({
    wallets: [wallet(1, U1, "Uno", { isDefault: true }), wallet(2, U1, "Due")],
  });

  const { status, body } = await request("PUT", "/wallet/2", {
    body: { is_default: true, name: "Rinominato" },
  });

  assert.equal(status, 200);
  assert.equal(body.name, "Rinominato");
  assert.equal(body.is_default, true);
  assert.deepEqual(defaultIds(U1), [2]);
});
