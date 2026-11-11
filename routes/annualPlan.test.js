/**
 * Piano delle spese annuali (migrazione 013) attraverso le route vere: voci e rate per utente,
 * solo un salvadanaio puo' pagare una voce, collegamento del pagamento, copia sull'anno dopo e
 * calcolo del piano sul saldo derivato.
 *
 * End-to-end: app Express vera, router vero, `requireAuth` vero, client
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

const CONTO = 1;
const ANNUALI = 2;
const ALTRUI = 9;

const baseline = () => ({
  Wallet: [
    { id: CONTO, userid: U1, name: "ISP", is_default: true, kind: "account", parent_wallet_id: null, opening_balance_cents: 0 },
    { id: ANNUALI, userid: U1, name: "Annuali", is_default: false, kind: "pot", parent_wallet_id: CONTO, opening_balance_cents: 6000, cap_cents: null, cap_from_plan: true },
    { id: ALTRUI, userid: U2, name: "Pot altrui", is_default: false, kind: "pot", parent_wallet_id: 8, opening_balance_cents: 0 },
  ],
  Transaction: [
    { id: 50, userid: U1, type: "E", amount: 477, wallet_id: CONTO, to_wallet_id: null, category_id: 1, date: "2026-10-05", description: "Assicurazione" },
    { id: 51, userid: U2, type: "E", amount: 10, wallet_id: 8, to_wallet_id: null, category_id: 2, date: "2026-10-05", description: "altrui" },
  ],
  annual_items: [],
  annual_installments: [],
});

const fake = await startFakeSupabase({
  users: {
    [TOKEN1]: { id: U1, email: "user1@example.com" },
    [TOKEN2]: { id: U2, email: "user2@example.com" },
  },
  tables: baseline(),
  columnDefaults: { annual_items: { active: true, note: null }, annual_installments: { transaction_id: null } },
});

process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const annualPlanRouter = (await import("./annualPlan.js")).default;

const app = express();
app.use(express.json());
app.use("/", annualPlanRouter);
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

const request = async (method, path, { token = TOKEN1, body } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/** Data YYYY-MM-DD a `months` mesi da oggi (il piano lavora sul mese corrente reale). */
const inMonths = (months, day = 10) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, day));
  return date.toISOString().slice(0, 10);
};

test("una voce si crea con le sue rate e torna con le rate ordinate", async () => {
  const { status, body } = await request("POST", "/annual-items", {
    body: {
      name: "Assicurazione",
      pot_wallet_id: ANNUALI,
      installments: [
        { due_date: "2027-10-05", amount_cents: 47700 },
        { due_date: "2027-04-05", amount_cents: 47700 },
      ],
    },
  });

  assert.equal(status, 201);
  assert.equal(body.name, "Assicurazione");
  assert.deepEqual(body.installments.map((row) => row.due_date), ["2027-04-05", "2027-10-05"]);
  assert.ok(body.installments.every((row) => row.paid === false && row.user_id === U1));
});

test("solo un proprio salvadanaio puo' pagare una voce", async () => {
  const onAccount = await request("POST", "/annual-items", { body: { name: "X", pot_wallet_id: CONTO } });
  const onOthers = await request("POST", "/annual-items", { body: { name: "X", pot_wallet_id: ALTRUI } });

  assert.equal(onAccount.status, 400);
  assert.equal(onOthers.status, 400);
  assert.equal(fake.state.store.annual_items.length, 0);
});

test("rate: importo positivo in centesimi interi e data YYYY-MM-DD", async () => {
  const created = await request("POST", "/annual-items", { body: { name: "Bollo", pot_wallet_id: ANNUALI } });
  const bad = await request("POST", `/annual-items/${created.body.id}/installments`, {
    body: { due_date: "31/05/2027", amount_cents: 19.2 },
  });

  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.details.map((d) => d.path).sort(), ["amount_cents", "due_date"]);
});

test("il pagamento si collega solo a una propria transazione, e si scollega con null", async () => {
  const created = await request("POST", "/annual-items", {
    body: { name: "Assicurazione", pot_wallet_id: ANNUALI, installments: [{ due_date: "2026-10-05", amount_cents: 47700 }] },
  });
  const installmentId = created.body.installments[0].id;

  const foreign = await request("PUT", `/annual-installments/${installmentId}/payment`, { body: { transaction_id: 51 } });
  const own = await request("PUT", `/annual-installments/${installmentId}/payment`, { body: { transaction_id: 50 } });
  const cleared = await request("PUT", `/annual-installments/${installmentId}/payment`, { body: { transaction_id: null } });

  assert.equal(foreign.status, 400);
  assert.equal(own.status, 200);
  assert.equal(own.body.paid, true);
  assert.equal(cleared.body.paid, false);
});

test("copia sull'anno dopo: ripete gli ultimi 12 mesi della voce, anche a cavallo di due anni", async () => {
  const created = await request("POST", "/annual-items", {
    body: {
      name: "AdE",
      pot_wallet_id: ANNUALI,
      installments: [
        { due_date: "2026-11-30", amount_cents: 12750 },
        { due_date: "2027-01-31", amount_cents: 12750 },
        { due_date: "2027-03-31", amount_cents: 12750 },
      ],
    },
  });

  const first = await request("POST", `/annual-items/${created.body.id}/copy-next-year`);
  const again = await request("POST", `/annual-items/${created.body.id}/copy-next-year`);
  const items = await request("GET", "/annual-items");

  // Ultimi 12 mesi fino al 31/03/2027: novembre, gennaio, marzo -> un anno avanti.
  assert.deepEqual(first.body, { copied: 3, until: "2028-03-31" });
  // La seconda copia ripete l'anno appena creato (2027-11…2028-03), senza doppioni.
  assert.deepEqual(again.body, { copied: 3, until: "2029-03-31" });
  assert.deepEqual(
    items.body[0].installments.map((row) => row.due_date),
    ["2026-11-30", "2027-01-31", "2027-03-31", "2027-11-30", "2028-01-31", "2028-03-31", "2028-11-30", "2029-01-31", "2029-03-31"]
  );
});

test("GET /annual-plan: quota dal saldo derivato del salvadanaio e tetto dal piano", async () => {
  // Saldo di Annuali = apertura 60 € (nessuna transazione). Rata da 300 € il mese prossimo:
  // un versamento utile -> 240 €/mese. Tetto dal piano = 300 € (rate dei mesi 1…12).
  await request("POST", "/annual-items", {
    body: { name: "Universita'", pot_wallet_id: ANNUALI, installments: [{ due_date: inMonths(1, 3), amount_cents: 30000 }] },
  });

  const { status, body } = await request("GET", `/annual-plan?walletId=${ANNUALI}`);

  assert.equal(status, 200);
  assert.equal(body.plan.balanceCents, 6000);
  assert.equal(body.plan.suggestedMonthlyCents, 24000);
  assert.equal(body.plan.capCents, 30000);
  assert.equal(body.items.length, 1);
});

test("GET /annual-plan rifiuta un conto o il salvadanaio di un altro utente", async () => {
  const account = await request("GET", `/annual-plan?walletId=${CONTO}`);
  const foreign = await request("GET", `/annual-plan?walletId=${ALTRUI}`);

  assert.equal(account.status, 404);
  assert.equal(foreign.status, 404);
});

test("le voci di un utente non sono visibili ne' modificabili da un altro", async () => {
  const created = await request("POST", "/annual-items", { body: { name: "Bollo", pot_wallet_id: ANNUALI } });

  const list = await request("GET", "/annual-items", { token: TOKEN2 });
  const update = await request("PUT", `/annual-items/${created.body.id}`, { token: TOKEN2, body: { name: "preso" } });
  const remove = await request("DELETE", `/annual-items/${created.body.id}`, { token: TOKEN2 });

  assert.deepEqual(list.body, []);
  assert.equal(update.status, 404);
  assert.equal(remove.status, 404);
  assert.equal(fake.state.store.annual_items[0].name, "Bollo");
});

test("una rata si segna pagata a mano, senza collegare un movimento, e lascia il calcolo", async () => {
  const created = await request("POST", "/annual-items", {
    body: { name: "Universita'", pot_wallet_id: ANNUALI, installments: [{ due_date: inMonths(1, 3), amount_cents: 30000 }] },
  });
  const id = created.body.installments[0].id;

  const paid = await request("PUT", `/annual-installments/${id}`, { body: { is_paid: true } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paid, true);
  assert.equal(paid.body.transaction_id ?? null, null);

  const plan = await request("GET", `/annual-plan?walletId=${ANNUALI}`);
  assert.equal(plan.body.items[0].installments[0].paid, true);
  assert.equal(plan.body.plan.suggestedMonthlyCents, 0, "una rata pagata non chiede piu' versamenti");

  const back = await request("PUT", `/annual-installments/${id}`, { body: { is_paid: false } });
  assert.equal(back.body.paid, false);
});
