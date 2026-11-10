/**
 * Una banca importa sempre in un conto, mai in un salvadanaio (U5, 10/11/2026): sia
 * l'import automatico (`PUT /bank/connections/:bank/auto-import`) sia quello manuale
 * (`POST /bank/import`) rifiutano un salvadanaio con un 400 `POT_NOT_ALLOWED`, senza scrivere.
 *
 * End-to-end: app Express vera, router vero, `requireAuth` vero; finto solo il server Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const TOKEN1 = "token-user-1";
const CONTO = 1;
const POT = 2;

const baseline = () => ({
  Wallet: [
    { id: CONTO, userid: U1, name: "ISP", is_default: true, kind: "account", parent_wallet_id: null, opening_balance_cents: 0 },
    { id: POT, userid: U1, name: "Emergenze", is_default: false, kind: "pot", parent_wallet_id: CONTO, opening_balance_cents: 0 },
  ],
  Category: [{ id: 7, userid: U1, name: "Spesa", type: "E", active: true }],
  bank_connections: [
    { id: 1, user_id: U1, bank_id: "BANK_X", account_id: "acc", access_token: null, refresh_token: null, import_wallet_id: CONTO, auto_import_from: "2026-11-01" },
  ],
  bank_transactions: [
    { id: 100, user_id: U1, bank_id: "BANK_X", account_id: "acc", external_id: "e1", amount: -12.5, currency: "EUR", date: "2026-11-09", description: "POS SUPERMERCATO", status: "synced" },
  ],
  Transaction: [],
});

const fake = await startFakeSupabase({ users: { [TOKEN1]: { id: U1, email: "user1@example.com" } }, tables: baseline() });
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const bankRouter = (await import("./bank.js")).default;
const app = express();
app.use(express.json());
app.use("/bank", bankRouter);
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
});

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN1}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

test("import automatico: un salvadanaio e' rifiutato e la configurazione resta sul conto", async () => {
  const { status, body } = await request("PUT", "/bank/connections/BANK_X/auto-import", { walletId: POT });
  assert.equal(status, 400);
  assert.equal(body.code, "POT_NOT_ALLOWED");
  assert.equal(fake.state.store.bank_connections[0].import_wallet_id, CONTO);
});

test("import automatico: un conto si configura come prima", async () => {
  const { status, body } = await request("PUT", "/bank/connections/BANK_X/auto-import", { walletId: CONTO });
  assert.equal(status, 200);
  assert.equal(body.autoImport.walletId, CONTO);
});

test("import manuale: un salvadanaio e' rifiutato e nessuna transazione viene scritta", async () => {
  const { status, body } = await request("POST", "/bank/import", { transactionIds: [100], walletId: POT, categoryId: 7 });
  assert.equal(status, 400);
  assert.equal(body.code, "POT_NOT_ALLOWED");
  assert.equal(fake.state.store.Transaction.length, 0);
  assert.equal(fake.state.store.bank_transactions[0].status, "synced");
});

test("import manuale: un conto supera il controllo (si ferma dopo, sulla categoria inesistente)", async () => {
  // L'inserimento vero usa un upsert che il Supabase finto non gestisce: qui basta dimostrare che
  // il controllo nuovo non blocca un conto. Una categoria inesistente fa fallire il passo dopo.
  const { status, body } = await request("POST", "/bank/import", { transactionIds: [100], walletId: CONTO, categoryId: 999 });
  assert.notEqual(body?.code, "POT_NOT_ALLOWED");
  assert.equal(status, 500);
  assert.match(body.error, /Categoria/);
  assert.equal(fake.state.store.Transaction.length, 0);
});
