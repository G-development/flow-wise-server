/**
 * Export dei dati (fase 6 C): GET /export e GET /export/transactions.csv.
 *
 * Invarianti:
 *   - solo i dati dell'utente del token, in ogni sezione, anche con un ?userid nella richiesta;
 *   - nessun segreto: i token di GoCardless e i payload grezzi non escono, anche se il database
 *     li restituisse (il fake ignora la lista di colonne del select, quindi lo verifica davvero);
 *   - una lista troncata fa fallire l'export invece di restituire una copia incompleta;
 *   - il CSV si apre nell'Excel italiano: BOM, separatore `;`, virgola decimale, campi protetti.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";

const baseline = () => ({
  Profile: [
    { id: U1, name: "Uno" },
    { id: U2, name: "Due" },
  ],
  Wallet: [
    { id: 11, userid: U1, name: "Conto", kind: "account", opening_balance_cents: 1000 },
    { id: 12, userid: U1, name: "Annuali", kind: "pot", parent_wallet_id: 11, opening_balance_cents: 0 },
    { id: 21, userid: U2, name: "Altrui", kind: "account", opening_balance_cents: 0 },
  ],
  Category: [
    { id: 101, userid: U1, name: "Spesa; casa", type: "E" },
    { id: 102, userid: U1, name: "Stipendio", type: "I" },
    { id: 201, userid: U2, name: "Segreta", type: "E" },
  ],
  Transaction: [
    { id: 1, userid: U1, date: "2026-11-01", type: "E", amount: 1234.5, category_id: 101, wallet_id: 11, description: 'Pane "buono"', note: null, is_refund: false },
    { id: 2, userid: U1, date: "2026-11-02", type: "I", amount: 18.5, category_id: 101, wallet_id: 11, description: "Rimborso\nriga due", note: "nota", is_refund: true },
    { id: 3, userid: U1, date: "2026-11-03", type: "T", amount: 50, category_id: null, wallet_id: 11, to_wallet_id: 12, description: "Accantonamento", note: null, is_refund: false },
    { id: 4, userid: U2, date: "2026-11-04", type: "E", amount: 999, category_id: 201, wallet_id: 21, description: "u2-secret", note: null, is_refund: false },
  ],
  Budget: [{ id: 1, userid: U2, categoryid: 201, walletid: 21, amount: 5 }],
  annual_items: [{ id: 1, user_id: U1, wallet_id: 12, name: "Bollo" }],
  annual_installments: [
    { id: 1, user_id: U1, item_id: 1, due_date: "2027-01-01", amount_cents: 20000, is_paid: false },
    { id: 2, user_id: U2, item_id: 9, due_date: "2027-01-01", amount_cents: 1, is_paid: false },
  ],
  category_rules: [{ id: 1, user_id: U1, keyword: "panificio", type: "E", category_id: 101 }],
  dashboard_layouts: [{ user_id: U1, widgets: [] }],
  bank_connections: [
    {
      id: "c1", user_id: U1, bank_id: "INTESA", account_id: "acc-1",
      access_token: "enc:SECRET-ACCESS", refresh_token: "enc:SECRET-REFRESH", token_expires_at: "2027-01-01",
      balance_amount: 104.08, balance_raw_data: { iban: "IT00" }, created_at: "2026-11-01",
    },
    { id: "c2", user_id: U2, bank_id: "OTHER", account_id: "acc-2", access_token: "enc:U2-TOKEN", created_at: "2026-11-01" },
  ],
  bank_transactions: [
    { id: "b1", user_id: U1, bank_id: "INTESA", date: "2026-11-01", amount: -1234.5, raw_data: { secret: true } },
    { id: "b2", user_id: U2, bank_id: "OTHER", date: "2026-11-01", amount: 1 },
  ],
  password_reset_tokens: [{ id: 1, user_id: U1, token: "RESET-CODE" }],
});

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "user1@example.com" } },
  tables: baseline(),
});

process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const exportRouter = (await import("./export.js")).default;
const { csvField, formatAmountIt } = await import("../utils/exportService.js");

const app = express();
app.use("/export", exportRouter);
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
  fake.state.failingTables.clear();
});

const get = async (path, token = TOKEN1) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${baseUrl}${path}`, { headers });
  // Dai byte e non da response.text(): il decoder di fetch toglie il BOM e lo nasconderebbe.
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes, text: bytes.toString("utf8") };
};

test("GET /export: tutte le sezioni, solo le righe dell'utente del token", async () => {
  const { response, text } = await get(`/export?userid=${U2}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="flow-wise-export-\d{4}-\d{2}-\d{2}\.json"/);
  const body = JSON.parse(text);

  assert.equal(body.format, "flow-wise-export");
  assert.equal(body.version, 1);
  assert.deepEqual(body.user, { id: U1, email: "user1@example.com" });
  assert.deepEqual(body.counts, {
    profile: 1, wallets: 2, categories: 2, transactions: 3, budgets: 0, annual_items: 1,
    annual_installments: 1, category_rules: 1, dashboard_layouts: 1, bank_connections: 1, bank_transactions: 1,
  });
  for (const [key, rows] of Object.entries(body.data)) {
    assert.equal(rows.length, body.counts[key], `counts.${key} non torna con le righe`);
    for (const row of rows) {
      const owner = row.userid ?? row.user_id ?? row.id;
      assert.equal(owner, U1, `una riga di ${key} non e' dell'utente del token`);
    }
  }
  assert.ok(!text.includes("u2-secret") && !text.includes(U2), "un dato dell'utente 2 e' trapelato");
});

test("GET /export: ogni query filtra per l'utente del token, mai per quello della richiesta", async () => {
  await get(`/export?userid=${U2}`);
  const queries = fake.restRequests();
  assert.ok(queries.length >= 11);
  for (const q of queries) {
    const filter = q.params.userid ?? q.params.user_id ?? q.params.id;
    assert.equal(filter, `eq.${U1}`, `query su ${q.table ?? q.path} senza il filtro dell'utente`);
  }
});

test("GET /export: niente token della banca, payload grezzi o codici di reset", async () => {
  const { text } = await get("/export");
  for (const secret of ["SECRET-ACCESS", "SECRET-REFRESH", "access_token", "refresh_token", "token_expires_at", "raw_data", "IT00", "RESET-CODE"]) {
    assert.ok(!text.includes(secret), `"${secret}" e' finito nell'export`);
  }
  const body = JSON.parse(text);
  assert.equal(body.data.bank_connections[0].balance_amount, 104.08, "i campi innocui restano");
  assert.equal(body.data.password_reset_tokens, undefined);
});

test("GET /export: senza token risponde 401", async () => {
  const { response } = await get("/export", null);
  assert.equal(response.status, 401);
});

test("GET /export: un errore su una tabella fa fallire tutto, nessun export parziale", async () => {
  fake.state.failingTables.add("category_rules");
  const { response, text } = await get("/export");
  assert.equal(response.status, 500);
  assert.ok(!text.includes("Conto"), "non deve uscire un export a meta'");
});

test("GET /export/transactions.csv: BOM, intestazione, ; e virgola decimale, campi protetti", async () => {
  const { response, bytes, text } = await get(`/export/transactions.csv?userid=${U2}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/csv; charset=utf-8/);
  assert.match(response.headers.get("content-disposition"), /filename="flow-wise-movements-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "manca il BOM: l'Excel italiano sbaglierebbe gli accenti");

  const lines = text.slice(1).split("\r\n");
  assert.equal(lines[0], "Date;Type;Amount;Category;Wallet;To wallet;Description;Note;Refund");
  assert.equal(lines[1], '2026-11-01;Expense;1234,50;"Spesa; casa";Conto;;"Pane ""buono""";;');
  // L'a capo dentro un campo resta \n tra virgolette; le righe sono separate da \r\n.
  assert.equal(lines[2], '2026-11-02;Income;18,50;"Spesa; casa";Conto;;"Rimborso\nriga due";nota;yes');
  assert.equal(lines[3], "2026-11-03;Transfer;50,00;;Conto;Annuali;Accantonamento;;");
  assert.equal(lines[4], "", "il file finisce con un a capo");
  assert.equal(lines.length, 5);
  assert.ok(!text.includes("u2-secret") && !text.includes("Segreta"));
});

test("csvField e formatAmountIt", () => {
  assert.equal(csvField(null), "");
  assert.equal(csvField("semplice"), "semplice");
  assert.equal(csvField("a;b"), '"a;b"');
  assert.equal(csvField('di "lui"'), '"di ""lui"""');
  assert.equal(formatAmountIt(0.1 + 0.2), "0,30");
  assert.equal(formatAmountIt(-7), "7,00");
  assert.equal(formatAmountIt("abc"), "");
});
