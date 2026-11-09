/**
 * Trasferimenti (type T, migrazione 011) attraverso le route vere.
 *
 * - POST/PUT /transaction: una T usa la categoria di sistema e wallet dell'utente;
 *   un'entrata o una spesa non può usare la categoria di sistema.
 * - GET /wallet: il saldo toglie dall'origine e aggiunge alla destinazione; un lato
 *   da assegnare tocca solo il lato noto.
 * - DELETE /wallet/:id: un wallet usato solo come destinazione è in uso.
 * - PUT/DELETE /category/:id: la categoria di sistema si rinomina e basta.
 * - GET /expense/all e /income/all: una T non compare.
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

const CONTO = 1;
const SALVADANAIO = 2;
const WALLET_U2 = 9;
const CAT_SPESA = 10;
const CAT_TRASFERIMENTO = 30;
const CAT_TRASFERIMENTO_U2 = 31;

const baseline = () => ({
  Transaction: [
    { id: 1, userid: U1, description: "spesa", note: null, amount: 40, type: "E", wallet_id: CONTO, to_wallet_id: null, category_id: CAT_SPESA, date: "2026-11-01" },
  ],
  Category: [
    { id: CAT_SPESA, userid: U1, name: "Spesa", type: "E", active: true },
    { id: CAT_TRASFERIMENTO, userid: U1, name: "Trasferimento", type: "T", active: true },
    { id: CAT_TRASFERIMENTO_U2, userid: U2, name: "Trasferimento", type: "T", active: true },
  ],
  Wallet: [
    { id: CONTO, userid: U1, name: "Conto", is_default: true, opening_balance_cents: 100000 },
    { id: SALVADANAIO, userid: U1, name: "Emergenze", is_default: false, opening_balance_cents: 0 },
    { id: WALLET_U2, userid: U2, name: "Altro", is_default: true, opening_balance_cents: 0 },
  ],
  Budget: [],
});

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "user1@example.com" } },
  tables: baseline(),
});

process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const transactionRouter = (await import("./transaction.js")).default;
const walletRouter = (await import("./wallet.js")).default;
const categoryRouter = (await import("./category.js")).default;
const expenseRouter = (await import("./expense.js")).default;
const incomeRouter = (await import("./income.js")).default;

const app = express();
app.use(express.json());
app.use("/transaction", transactionRouter);
app.use("/wallet", walletRouter);
app.use("/category", categoryRouter);
app.use("/expense", expenseRouter);
app.use("/income", incomeRouter);
app.use((err, req, res, next) => {
  void next;
  res.status(500).json({ error: err.message });
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  return fake.close();
});

test.beforeEach(() => {
  for (const [table, rows] of Object.entries(baseline())) fake.state.store[table] = rows;
  fake.state.requests.length = 0;
});

const request = async (method, path, body) => {
  const headers = { Authorization: `Bearer ${TOKEN1}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const transfer = (overrides = {}) => ({
  description: "Accantonamento",
  amount: 100,
  date: "2026-11-02",
  type: "T",
  wallet_id: CONTO,
  to_wallet_id: SALVADANAIO,
  category_id: CAT_TRASFERIMENTO,
  ...overrides,
});

const balances = async () => {
  const { status, body } = await request("GET", "/wallet");
  assert.equal(status, 200);
  return Object.fromEntries(body.map((wallet) => [wallet.id, wallet.balance]));
};

// ---------------------------------------------------------------------------
// Creazione e saldo
// ---------------------------------------------------------------------------

test("POST di una T valida: salvata con origine e destinazione, saldo spostato", async () => {
  const { status, body } = await request("POST", "/transaction", transfer());

  assert.equal(status, 201);
  assert.equal(body.type, "T");
  assert.equal(body.wallet_id, CONTO);
  assert.equal(body.to_wallet_id, SALVADANAIO);

  // 1000.00 − 40.00 di spesa − 100.00 trasferiti; il salvadanaio riceve 100.00.
  assert.deepEqual(await balances(), { [CONTO]: 860, [SALVADANAIO]: 100 });
});

test("una T da assegnare tocca solo il conto", async () => {
  const accantonamento = await request("POST", "/transaction", transfer({ to_wallet_id: null }));
  const riunione = await request("POST", "/transaction", transfer({ wallet_id: null, to_wallet_id: CONTO, amount: 30 }));

  assert.equal(accantonamento.status, 201);
  assert.equal(riunione.status, 201);
  assert.equal(riunione.body.wallet_id, null);

  assert.deepEqual(await balances(), { [CONTO]: 1000 - 40 - 100 + 30, [SALVADANAIO]: 0 });
});

test("una T con una categoria che non è quella di sistema è rifiutata", async () => {
  const { status, body } = await request("POST", "/transaction", transfer({ category_id: CAT_SPESA }));

  assert.equal(status, 400);
  assert.match(body.error, /transfer category/);
  assert.equal(fake.state.store.Transaction.length, 1, "nessuna riga scritta");
});

test("una T con la categoria di sistema di un altro utente è rifiutata", async () => {
  const { status } = await request("POST", "/transaction", transfer({ category_id: CAT_TRASFERIMENTO_U2 }));

  assert.equal(status, 400);
  assert.equal(fake.state.store.Transaction.length, 1);
});

test("una T verso il wallet di un altro utente è rifiutata", async () => {
  const { status, body } = await request("POST", "/transaction", transfer({ to_wallet_id: WALLET_U2 }));

  assert.equal(status, 400);
  assert.match(body.error, new RegExp(`wallet ${WALLET_U2} not found`));
  assert.equal(fake.state.store.Transaction.length, 1);
});

test("una spesa con la categoria di sistema è rifiutata", async () => {
  const { status, body } = await request("POST", "/transaction", {
    description: "finta spesa",
    amount: 10,
    date: "2026-11-02",
    type: "E",
    wallet_id: CONTO,
    category_id: CAT_TRASFERIMENTO,
  });

  assert.equal(status, 400);
  assert.match(body.error, /only be used by transfers/);
});

test("PUT: assegnare il lato mancante aggiorna il saldo del salvadanaio", async () => {
  const created = await request("POST", "/transaction", transfer({ to_wallet_id: null }));
  assert.deepEqual(await balances(), { [CONTO]: 860, [SALVADANAIO]: 0 });

  const { status, body } = await request("PUT", `/transaction/${created.body.id}`, transfer());

  assert.equal(status, 200);
  assert.equal(body.to_wallet_id, SALVADANAIO);
  assert.deepEqual(await balances(), { [CONTO]: 860, [SALVADANAIO]: 100 });
});

test("PUT: una spesa si può trasformare in un trasferimento", async () => {
  const { status, body } = await request("PUT", "/transaction/1", transfer({ amount: 40 }));

  assert.equal(status, 200);
  assert.equal(body.type, "T");
  assert.equal(body.category_id, CAT_TRASFERIMENTO);
  // Prima −40 di spesa sul conto, ora −40 dal conto e +40 sul salvadanaio.
  assert.deepEqual(await balances(), { [CONTO]: 960, [SALVADANAIO]: 40 });
});

test("GET /expense/all e /income/all non restituiscono le T", async () => {
  await request("POST", "/transaction", transfer());

  const expenses = await request("GET", "/expense/all");
  const incomes = await request("GET", "/income/all");

  assert.deepEqual(expenses.body.data.map((row) => row.type), ["E"]);
  assert.deepEqual(incomes.body.data, []);
});

// ---------------------------------------------------------------------------
// Eliminazione dei wallet
// ---------------------------------------------------------------------------

test("un wallet usato solo come destinazione di una T non si elimina", async () => {
  await request("POST", "/transaction", transfer());

  const { status, body } = await request("DELETE", `/wallet/${SALVADANAIO}`);

  assert.equal(status, 409);
  assert.equal(body.code, "WALLET_IN_USE");
  assert.equal(body.transactionCount, 1);
  assert.ok(fake.state.store.Wallet.some((wallet) => wallet.id === SALVADANAIO));
});

// ---------------------------------------------------------------------------
// Categoria di sistema
// ---------------------------------------------------------------------------

test("la categoria di sistema non si elimina", async () => {
  const { status, body } = await request("DELETE", `/category/${CAT_TRASFERIMENTO}`);

  assert.equal(status, 409);
  assert.equal(body.code, "SYSTEM_CATEGORY");
  assert.ok(fake.state.store.Category.some((category) => category.id === CAT_TRASFERIMENTO));
});

test("la categoria di sistema non si disattiva e non cambia tipo, ma si rinomina", async () => {
  const deactivate = await request("PUT", `/category/${CAT_TRASFERIMENTO}`, { active: false });
  const retype = await request("PUT", `/category/${CAT_TRASFERIMENTO}`, { type: "E" });
  const rename = await request("PUT", `/category/${CAT_TRASFERIMENTO}`, { name: "Giroconti" });

  assert.equal(deactivate.status, 409);
  assert.equal(retype.status, 409);
  assert.equal(rename.status, 200);

  const stored = fake.state.store.Category.find((category) => category.id === CAT_TRASFERIMENTO);
  assert.deepEqual(
    { name: stored.name, type: stored.type, active: stored.active },
    { name: "Giroconti", type: "T", active: true }
  );
});

test("una categoria normale si disattiva come prima", async () => {
  const { status } = await request("PUT", `/category/${CAT_SPESA}`, { active: false });

  assert.equal(status, 200);
});
