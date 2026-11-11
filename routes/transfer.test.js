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

// ---------------------------------------------------------------------------
// Elenco completo con le date (pagina Movements del client)
// ---------------------------------------------------------------------------

test("GET /transaction/all filtra per startDate / endDate e include le T", async () => {
  await request("POST", "/transaction", transfer({ date: "2026-11-02" }));
  await request("POST", "/transaction", transfer({ date: "2026-12-05", amount: 20 }));

  const all = await request("GET", "/transaction/all");
  const november = await request("GET", "/transaction/all?startDate=2026-11-01&endDate=2026-11-30");
  const fromDecember = await request("GET", "/transaction/all?startDate=2026-12-01");

  assert.equal(all.body.data.length, 3);
  assert.deepEqual(november.body.data.map((row) => [row.date, row.type]).sort(), [["2026-11-01", "E"], ["2026-11-02", "T"]]);
  assert.deepEqual(fromDecember.body.data.map((row) => row.amount), [20]);
  assert.equal(november.body.truncated, false);
});

// ---------------------------------------------------------------------------
// Regole decise da Gio l'11/11/2026
// ---------------------------------------------------------------------------

// Un vero salvadanaio di CONTO, un secondo conto e un salvadanaio dell'altro conto: aggiunti
// solo qui, per non cambiare i saldi attesi dai test sopra.
const POT_DI_CONTO = 3;
const ALTRO_CONTO = 4;
const POT_DI_ALTRO = 5;
const CAT_STIPENDIO = 11;
const CAT_SPESA_U2 = 12;
const addPotFixtures = () => {
  fake.state.store.Wallet.push(
    { id: POT_DI_CONTO, userid: U1, name: "Savings", is_default: false, kind: "pot", parent_wallet_id: CONTO, opening_balance_cents: 0 },
    { id: ALTRO_CONTO, userid: U1, name: "Trade Republic", is_default: false, kind: "account", parent_wallet_id: null, opening_balance_cents: 0 },
    { id: POT_DI_ALTRO, userid: U1, name: "Pot TR", is_default: false, kind: "pot", parent_wallet_id: ALTRO_CONTO, opening_balance_cents: 0 }
  );
  fake.state.store.Category.push(
    { id: CAT_STIPENDIO, userid: U1, name: "Stipendio", type: "I", active: true },
    { id: CAT_SPESA_U2, userid: U2, name: "Spesa", type: "E", active: true }
  );
};

test("salvadanaio: scambia soldi con il suo conto, nei due versi", async () => {
  addPotFixtures();
  const versamento = await request("POST", "/transaction", transfer({ wallet_id: CONTO, to_wallet_id: POT_DI_CONTO }));
  const prelievo = await request("POST", "/transaction", transfer({ wallet_id: POT_DI_CONTO, to_wallet_id: CONTO }));
  assert.equal(versamento.status, 201);
  assert.equal(prelievo.status, 201);
});

test("salvadanaio: verso un altro conto o un altro salvadanaio e' rifiutato, senza scrivere", async () => {
  addPotFixtures();
  const before = fake.state.store.Transaction.length;
  const versoAltroConto = await request("POST", "/transaction", transfer({ wallet_id: POT_DI_CONTO, to_wallet_id: ALTRO_CONTO }));
  const daAltroConto = await request("POST", "/transaction", transfer({ wallet_id: ALTRO_CONTO, to_wallet_id: POT_DI_CONTO }));
  const traSalvadanai = await request("POST", "/transaction", transfer({ wallet_id: POT_DI_CONTO, to_wallet_id: POT_DI_ALTRO }));
  for (const response of [versoAltroConto, daAltroConto, traSalvadanai]) {
    assert.equal(response.status, 400);
    assert.match(response.body.error, /only exchange money with its own account/);
  }
  assert.equal(fake.state.store.Transaction.length, before);
});

test("salvadanaio: assegnare a un trasferimento il salvadanaio di un altro conto e' rifiutato", async () => {
  addPotFixtures();
  const pending = await request("POST", "/transaction", transfer({ wallet_id: ALTRO_CONTO, to_wallet_id: null }));
  assert.equal(pending.status, 201);
  const sbagliato = await request("PUT", `/transaction/${pending.body.id}`, transfer({ wallet_id: ALTRO_CONTO, to_wallet_id: POT_DI_CONTO }));
  const giusto = await request("PUT", `/transaction/${pending.body.id}`, transfer({ wallet_id: ALTRO_CONTO, to_wallet_id: POT_DI_ALTRO }));
  assert.equal(sbagliato.status, 400);
  assert.equal(giusto.status, 200);
});

test("entrate e spese: categoria dell'utente e dello stesso tipo, altrimenti 400", async () => {
  addPotFixtures();
  const spesa = (category_id, type = "E") => ({ description: "x", amount: 5, date: "2026-11-03", type, wallet_id: CONTO, category_id });
  const before = fake.state.store.Transaction.length;

  const tipoSbagliato = await request("POST", "/transaction", spesa(CAT_STIPENDIO));
  const altrui = await request("POST", "/transaction", spesa(CAT_SPESA_U2));
  const inesistente = await request("POST", "/transaction", spesa(999));
  assert.equal(tipoSbagliato.status, 400);
  assert.match(tipoSbagliato.body.error, /does not match/);
  assert.equal(altrui.status, 400);
  assert.equal(inesistente.status, 400);
  assert.equal(fake.state.store.Transaction.length, before);

  const ok = await request("POST", "/transaction", spesa(CAT_SPESA));
  const entrata = await request("POST", "/transaction", spesa(CAT_STIPENDIO, "I"));
  assert.equal(ok.status, 201);
  assert.equal(entrata.status, 201);
});

test("entrate e spese: anche il PUT rifiuta una categoria del tipo sbagliato", async () => {
  addPotFixtures();
  const { status, body } = await request("PUT", "/transaction/1", {
    description: "spesa", amount: 40, date: "2026-11-01", type: "E", wallet_id: CONTO, category_id: CAT_STIPENDIO,
  });
  assert.equal(status, 400);
  assert.match(body.error, /does not match/);
  assert.equal(fake.state.store.Transaction.find((t) => t.id === 1).category_id, CAT_SPESA);
});


// ---------------------------------------------------------------------------
// Rimborsi (fase 5, migrazione 014)
// ---------------------------------------------------------------------------

const refund = (overrides = {}) => ({
  description: "quota cena", amount: 36, date: "2026-11-09", type: "I", is_refund: true, wallet_id: CONTO, category_id: CAT_SPESA, ...overrides,
});

test("rimborso: un'entrata con una categoria di spesa, salvata con is_refund e saldo in entrata", async () => {
  const { status, body } = await request("POST", "/transaction", refund());
  assert.equal(status, 201);
  assert.equal(body.type, "I");
  assert.equal(body.is_refund, true);
  // 1000 − 40 di spesa + 36 rimborsati.
  const saldi = await balances();
  assert.equal(saldi[CONTO], 996);
});

test("rimborso: con una categoria di entrata, su una spesa o su un trasferimento e' rifiutato", async () => {
  addPotFixtures();
  const categoriaEntrata = await request("POST", "/transaction", refund({ category_id: CAT_STIPENDIO }));
  const suSpesa = await request("POST", "/transaction", refund({ type: "E" }));
  const suTrasferimento = await request("POST", "/transaction", transfer({ is_refund: true }));
  assert.equal(categoriaEntrata.status, 400);
  assert.match(categoriaEntrata.body.error, /expense category/);
  assert.equal(suSpesa.status, 400);
  assert.equal(suTrasferimento.status, 400);
});

test("rimborso: escluso da /income/all, incluso in /expense/all", async () => {
  addPotFixtures();
  await request("POST", "/transaction", refund());
  await request("POST", "/transaction", { description: "stipendio", amount: 1800, date: "2026-11-01", type: "I", wallet_id: CONTO, category_id: CAT_STIPENDIO });

  const incomes = await request("GET", "/income/all");
  const expenses = await request("GET", "/expense/all");
  assert.deepEqual(incomes.body.data.map((row) => row.description), ["stipendio"]);
  assert.deepEqual(expenses.body.data.map((row) => row.description).sort(), ["quota cena", "spesa"]);
});

test("rimborso: un PUT lo riporta a entrata normale solo con una categoria di entrata", async () => {
  addPotFixtures();
  const created = await request("POST", "/transaction", refund());
  const sbagliato = await request("PUT", `/transaction/${created.body.id}`, refund({ is_refund: false }));
  const giusto = await request("PUT", `/transaction/${created.body.id}`, refund({ is_refund: false, category_id: CAT_STIPENDIO }));
  assert.equal(sbagliato.status, 400);
  assert.equal(giusto.status, 200);
  assert.equal(giusto.body.is_refund, false);
});
