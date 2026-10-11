/**
 * Invariante 3 — ogni lettura e' isolata per utente: l'`userid` del filtro viene
 * SEMPRE dal token verificato (`req.user.id`), mai dal body ne' dai query param.
 *
 * Il server usa la service-role key, quindi le policy RLS non lo proteggono: se
 * una route leggesse `req.query.userid` o `req.body.userid`, un utente autenticato
 * vedrebbe (o scriverebbe) i dati di chiunque altro. Questi test lo verificano su
 * due fronti indipendenti:
 *
 *   - la **risposta** contiene solo le righe dell'utente del token;
 *   - la **query** che raggiunge PostgREST filtra per quello stesso `userid`,
 *     anche quando la richiesta HTTP ne fornisce un altro (parametro o body).
 *
 * End-to-end: app Express vera, router veri, `requireAuth` vero, client
 * `@supabase/supabase-js` vero; finto solo il server Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";
const TOKEN2 = "token-user-2";

const baseline = () => ({
  Transaction: [
    { id: 1, userid: U1, description: "u1-expense", note: null, amount: 10, type: "E", wallet_id: 11, category_id: 101, date: "2026-01-01" },
    { id: 2, userid: U1, description: "u1-income", note: null, amount: 100, type: "I", wallet_id: 11, category_id: 102, date: "2026-01-02" },
    { id: 3, userid: U2, description: "u2-secret", note: null, amount: 999, type: "E", wallet_id: 22, category_id: 202, date: "2026-01-03" },
  ],
  Category: [
    { id: 101, userid: U1, name: "U1 Food", type: "E", active: true },
    { id: 102, userid: U1, name: "U1 Salary", type: "I", active: true },
    { id: 202, userid: U2, name: "U2 Secret", type: "E", active: true },
  ],
  Wallet: [
    { id: 11, userid: U1, name: "U1 Main", is_default: true, opening_balance_cents: 0 },
    { id: 22, userid: U2, name: "U2 Main", is_default: true, opening_balance_cents: 0 },
  ],
});

const fake = await startFakeSupabase({
  users: {
    [TOKEN1]: { id: U1, email: "user1@example.com" },
    [TOKEN2]: { id: U2, email: "user2@example.com" },
  },
  tables: baseline(),
  columnDefaults: { Wallet: { opening_balance_cents: 0 } },
});

process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const transactionRouter = (await import("./transaction.js")).default;
const incomeRouter = (await import("./income.js")).default;
const expenseRouter = (await import("./expense.js")).default;
const categoryRouter = (await import("./category.js")).default;
const walletRouter = (await import("./wallet.js")).default;

const app = express();
app.use(express.json());
app.use("/transaction", transactionRouter);
app.use("/income", incomeRouter);
app.use("/expense", expenseRouter);
app.use("/category", categoryRouter);
app.use("/wallet", walletRouter);
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

/** Ripristina il dataset e il registro: ogni test parte dallo stesso stato. */
const seed = () => {
  for (const [table, rows] of Object.entries(baseline())) {
    fake.state.store[table] = rows;
  }
  fake.state.requests.length = 0;
};

test.beforeEach(seed);

/** Ogni richiesta PostgREST filtrata per `userid` deve filtrare per l'utente del token. */
const assertQueriesScopedTo = (userId) => {
  for (const request of fake.restRequests()) {
    if (request.params.userid !== undefined) {
      assert.equal(
        request.params.userid,
        `eq.${userId}`,
        `una query ha filtrato per "${request.params.userid}" invece che per l'utente del token`
      );
    }
  }
};

const onlyFromUser1 = (rows) => {
  assert.ok(rows.length > 0, "il dataset di prova dell'utente 1 non deve essere vuoto");
  for (const row of rows) {
    assert.equal(row.userid ?? U1, U1);
    assert.notEqual(row.id, 3, "la transazione dell'utente 2 e' trapelata");
    assert.notEqual(row.id, 202, "la categoria dell'utente 2 e' trapelata");
  }
};

// ---------------------------------------------------------------------------
// L'userid nei query param non conta
// ---------------------------------------------------------------------------

test("GET /transaction/all ignora ?userid e resta scoped al token", async () => {
  const { status, body } = await request("GET", `/transaction/all?userid=${U2}`);

  assert.equal(status, 200);
  assert.deepEqual(
    body.data.map((row) => row.id),
    [2, 1],
    "solo le transazioni dell'utente del token, per data decrescente"
  );
  onlyFromUser1(body.data);
  assertQueriesScopedTo(U1);
});

test("GET /expense/all e GET /income/all ignorano ?userid", async () => {
  const expenses = await request("GET", `/expense/all?userid=${U2}`);
  assert.equal(expenses.status, 200);
  assert.deepEqual(expenses.body.data.map((row) => row.id), [1]);
  onlyFromUser1(expenses.body.data);

  const incomes = await request("GET", `/income/all?userid=${U2}`);
  assert.equal(incomes.status, 200);
  assert.deepEqual(incomes.body.data.map((row) => row.id), [2]);
  onlyFromUser1(incomes.body.data);

  assertQueriesScopedTo(U1);
});

test("GET /category ignora ?userid", async () => {
  const { status, body } = await request("GET", `/category?userid=${U2}`);

  assert.equal(status, 200);
  assert.deepEqual(body.map((row) => row.id), [101, 102]);
  assertQueriesScopedTo(U1);
});

test("GET /wallet ignora ?userid e somma solo le transazioni del token", async () => {
  const { status, body } = await request("GET", `/wallet?userid=${U2}`);

  assert.equal(status, 200);
  assert.deepEqual(body.map((wallet) => wallet.id), [11]);
  assert.equal(body[0].balance, 90, "100.00 di entrata - 10.00 di spesa; i 999.00 altrui non entrano");
  assertQueriesScopedTo(U1);
});

// ---------------------------------------------------------------------------
// L'userid nel body non conta
// ---------------------------------------------------------------------------

test("POST /transaction con un userid nel body scrive comunque a nome del token", async () => {
  const { status, body } = await request("POST", "/transaction", {
    body: {
      description: "tentativo",
      amount: 5,
      date: "2026-02-01",
      type: "E",
      wallet_id: 11,
      category_id: 101,
      // Forzatura: deve essere ignorata (lo schema zod la scarta, e la route usa req.user.id).
      userid: U2,
    },
  });

  assert.equal(status, 201);
  assert.equal(body.userid, U1, "la riga appartiene all'utente del token");

  const created = fake.state.store.Transaction.find((row) => row.description === "tentativo");
  assert.ok(created, "la transazione e' stata creata");
  assert.equal(created.userid, U1, "il body non ha dirottato la scrittura su un altro utente");
  assert.equal(
    fake.state.store.Transaction.some((row) => row.userid === U2),
    true,
    "l'utente 2 resta con la sola riga iniziale"
  );
  assert.equal(fake.state.store.Transaction.filter((row) => row.userid === U2).length, 1);
});

test("PUT /transaction/:id non tocca la transazione di un altro utente", async () => {
  const before = { ...fake.state.store.Transaction.find((row) => row.id === 3) };

  const { status } = await request("PUT", "/transaction/3", {
    body: {
      description: "dirottata",
      amount: 1,
      date: "2026-02-01",
      type: "E",
      wallet_id: 22,
      category_id: 202,
      userid: U1,
    },
  });

  assert.notEqual(status, 200, "l'update dell'altrui riga deve fallire");
  assert.deepEqual(
    fake.state.store.Transaction.find((row) => row.id === 3),
    before,
    "la transazione dell'utente 2 e' rimasta identica"
  );
});

test("GET /transaction/:id di un altro utente non restituisce la riga", async () => {
  const { status, body } = await request("GET", "/transaction/3");

  assert.equal(status, 404);
  assert.equal(body?.description, undefined, "nessun dato dell'utente 2 nella risposta");
});

test("GET /category/:id di un altro utente non restituisce la categoria", async () => {
  const { status, body } = await request("GET", "/category/202");

  assert.equal(status, 404);
  assert.equal(body?.name, undefined, "nessun dato dell'utente 2 nella risposta");
});

// ---------------------------------------------------------------------------
// Il token e' l'unico modo di entrare
// ---------------------------------------------------------------------------

test("senza token o con token non valido ogni lettura risponde 401", async () => {
  const reads = ["/transaction/all", "/expense/all", "/income/all", "/category", "/wallet"];

  for (const path of reads) {
    assert.equal((await request("GET", path, { token: null })).status, 401, `${path} senza token`);
    assert.equal((await request("GET", path, { token: "forged" })).status, 401, `${path} con token falso`);
  }
});

test("il dataset e' davvero condiviso: l'utente 2 vede solo le proprie righe", async () => {
  const { status, body } = await request("GET", "/transaction/all", { token: TOKEN2 });

  assert.equal(status, 200);
  assert.deepEqual(body.data.map((row) => row.id), [3], "l'utente 2 vede solo la sua transazione");
  assertQueriesScopedTo(U2);
});
