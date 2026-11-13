/**
 * Elimina account (R4, 13/11/2026): DELETE /users/me.
 *
 * Invarianti:
 *   - senza la propria email esatta non si cancella niente;
 *   - si cancellano tutte le righe dell'utente del token, in ogni tabella, e poi l'utente di Auth;
 *   - le righe di un altro utente restano tutte;
 *   - se un passo fallisce ci si ferma e l'utente di Auth resta (si puo' riprovare).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";

const both = (ownerKey, base) => [
  { ...base, id: base.id ?? 1, [ownerKey]: U1 },
  { ...base, id: (base.id ?? 1) + 100, [ownerKey]: U2 },
];

const baseline = () => ({
  Profile: [
    { id: U1, avatar_url: "https://res.cloudinary.com/x/image/upload/v17/profile_pics/abc123.jpg" },
    { id: U2, avatar_url: null },
  ],
  annual_installments: both("user_id", { id: 1, item_id: 1 }),
  annual_items: both("user_id", { id: 1, pot_wallet_id: 12 }),
  category_rules: both("user_id", { id: 1, keyword: "bar" }),
  Transaction: both("userid", { id: 1, amount: 5, type: "E" }),
  Budget: both("userid", { id: 1 }),
  dashboard_layouts: both("user_id", { id: 1, widgets: [] }),
  password_reset_tokens: both("user_id", { id: 1, token: "t" }),
  bank_transactions: both("user_id", { id: 1, amount: 1 }),
  bank_connections: both("user_id", { id: 1, bank_id: "INTESA" }),
  Wallet: [
    { id: 11, userid: U1, kind: "account", is_default: true },
    { id: 12, userid: U1, kind: "pot", parent_wallet_id: 11 },
    { id: 21, userid: U2, kind: "account", is_default: true },
  ],
  Category: both("userid", { id: 1, name: "Altro" }),
});

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "Gio@Example.com" } },
  tables: baseline(),
});
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
// Niente Cloudinary vero nei test: dotenv non sovrascrive variabili gia' impostate.
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";

const express = (await import("express")).default;
const userRouter = (await import("./user.js")).default;
const { cloudinaryPublicId, emailMatches, DELETION_STEPS } = await import("../utils/accountDeletion.js");

const app = express();
app.use(express.json());
app.use("/users", userRouter);
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
  fake.state.deletedUsers.length = 0;
  fake.state.failAdminDelete = false;
});

const del = (body, token = TOKEN1) =>
  fetch(`${baseUrl}/users/me`, {
    method: "DELETE",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const rowsOf = (userId) =>
  Object.entries(fake.state.store).flatMap(([table, rows]) =>
    rows.filter((row) => (row.userid ?? row.user_id ?? row.id) === userId).map((row) => `${table}:${row.id}`)
  );

test("email sbagliata o mancante: 400 e niente cancellato", async () => {
  const before = rowsOf(U1).length;
  assert.equal((await del({ confirmEmail: "altro@example.com" })).status, 400);
  assert.equal((await del({})).status, 400);
  assert.equal(rowsOf(U1).length, before);
  assert.deepEqual(fake.state.deletedUsers, []);
});

test("senza token: 401", async () => {
  assert.equal((await del({ confirmEmail: "gio@example.com" }, null)).status, 401);
});

test("email giusta (maiuscole e spazi non contano): cancella tutto dell'utente e l'utente di Auth", async () => {
  const res = await del({ confirmEmail: "  gio@example.COM " });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.removed, "object");
  assert.equal(body.avatarRemoved, false, "nei test Cloudinary e' spento: la foto non si tocca");
  assert.deepEqual(rowsOf(U1), [], "nessuna riga dell'utente deve restare");
  assert.deepEqual(fake.state.deletedUsers, [U1]);
});

test("le righe di un altro utente restano tutte", async () => {
  const before = rowsOf(U2);
  await del({ confirmEmail: "gio@example.com" });
  assert.deepEqual(rowsOf(U2), before);
  for (const request of fake.restRequests().filter((r) => r.method === "DELETE")) {
    const filter = request.params.userid ?? request.params.user_id ?? request.params.id;
    assert.equal(filter, `eq.${U1}`, "ogni DELETE filtra per l'utente del token");
  }
});

test("i salvadanai si cancellano prima dei conti", async () => {
  await del({ confirmEmail: "gio@example.com" });
  const walletDeletes = fake.restRequests().filter((r) => r.method === "DELETE" && r.path.endsWith("/Wallet"));
  assert.equal(walletDeletes.length, 2);
  assert.equal(walletDeletes[0].params.kind, "eq.pot");
});

test("un passo che fallisce ferma tutto: l'utente di Auth resta e si puo' riprovare", async () => {
  fake.state.failingTables.add("bank_connections");
  const res = await del({ confirmEmail: "gio@example.com" });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /bank_connections/);
  assert.deepEqual(fake.state.deletedUsers, []);
  assert.ok(fake.state.store.Wallet.some((w) => w.userid === U1), "i wallet dopo il passo fallito non sono toccati");
  fake.state.failingTables.clear();
  assert.equal((await del({ confirmEmail: "gio@example.com" })).status, 200, "la seconda volta va");
  assert.deepEqual(rowsOf(U1), []);
});

test("errore nel cancellare l'utente di Auth: 500, si puo' riprovare", async () => {
  fake.state.failAdminDelete = true;
  const res = await del({ confirmEmail: "gio@example.com" });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /login/);
});

test("cloudinaryPublicId, emailMatches e l'elenco dei passi", () => {
  assert.equal(cloudinaryPublicId("https://res.cloudinary.com/x/image/upload/v17/profile_pics/abc123.jpg"), "profile_pics/abc123");
  assert.equal(cloudinaryPublicId("https://example.com/me.png"), null);
  assert.equal(cloudinaryPublicId(null), null);
  assert.equal(emailMatches("A@b.it", "a@B.it "), true);
  assert.equal(emailMatches("", ""), false);
  assert.equal(emailMatches(undefined, "a@b.it"), false);
  const tables = DELETION_STEPS.map((s) => s.table);
  assert.ok(tables.indexOf("annual_installments") < tables.indexOf("annual_items"));
  assert.ok(tables.indexOf("Transaction") < tables.indexOf("Category"));
  assert.ok(tables.lastIndexOf("Wallet") < tables.indexOf("Category"));
  assert.equal(tables.at(-1), "Profile");
});
