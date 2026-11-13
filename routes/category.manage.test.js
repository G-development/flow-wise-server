/**
 * Gestione delle categorie (13/11/2026): statistiche, unione di due categorie, regole visibili.
 *
 * Invarianti: tutto e' dell'utente del token; l'unione non tocca mai la categoria di sistema
 * dei trasferimenti ne' categorie di tipo diverso; le regole a mano si normalizzano come quelle
 * imparate e una parola gia' presente passa alla nuova categoria invece di duplicarsi.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";
const YEAR = new Date().getUTCFullYear();

const baseline = () => ({
  Category: [
    { id: 1, userid: U1, name: "Spesa", type: "E", active: true },
    { id: 2, userid: U1, name: "Supermercato", type: "E", active: true },
    { id: 3, userid: U1, name: "Stipendio", type: "I", active: true },
    { id: 4, userid: U1, name: "Transfer", type: "T", active: true },
    { id: 9, userid: U2, name: "Altrui", type: "E", active: true },
  ],
  Transaction: [
    { id: 1, userid: U1, category_id: 1, amount: 10, type: "E", is_refund: false, date: `${YEAR}-02-01` },
    { id: 2, userid: U1, category_id: 1, amount: 4, type: "I", is_refund: true, date: `${YEAR}-03-01` },
    { id: 3, userid: U1, category_id: 2, amount: 7.5, type: "E", is_refund: false, date: `${YEAR - 1}-12-31` },
    { id: 4, userid: U1, category_id: 3, amount: 100, type: "I", is_refund: false, date: `${YEAR}-01-27` },
    { id: 5, userid: U2, category_id: 9, amount: 999, type: "E", is_refund: false, date: `${YEAR}-01-01` },
  ],
  category_rules: [
    { id: 1, user_id: U1, keyword: "lidl", type: "E", category_id: 2, source: "learned" },
    { id: 2, user_id: U1, keyword: "coop", type: "E", category_id: 1, source: "manual" },
    { id: 3, user_id: U2, keyword: "lidl", type: "E", category_id: 9, source: "manual" },
  ],
  Budget: [{ id: 1, userid: U1, categoryid: 2, amount: 50 }],
});

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "a@b.it" } },
  tables: baseline(),
});
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const categoryRouter = (await import("./category.js")).default;
const ruleRouter = (await import("./categoryRules.js")).default;
const app = express();
app.use(express.json());
app.use("/category", categoryRouter);
app.use("/category-rules", ruleRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  return fake.close();
});
test.beforeEach(() => {
  for (const [table, rows] of Object.entries(baseline())) fake.state.store[table] = rows;
  fake.state.requests.length = 0;
});

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN1}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test("stats: movimenti, totale dell'anno (rimborso in meno), ultimo uso e regole, solo dell'utente", async () => {
  const { status, body } = await call("GET", "/category/stats");
  assert.equal(status, 200);
  assert.equal(body.year, YEAR);
  assert.deepEqual(body.stats["1"], { movements: 2, yearCents: 1000 - 400, lastUsed: `${YEAR}-03-01`, rules: 1 });
  assert.deepEqual(body.stats["2"], { movements: 1, yearCents: 0, lastUsed: `${YEAR - 1}-12-31`, rules: 1 });
  assert.equal(body.stats["9"], undefined, "una categoria di un altro utente non compare");
});

test("merge: movimenti, regole e budget passano alla seconda, la prima sparisce", async () => {
  const { status, body } = await call("POST", "/category/2/merge", { into_id: 1 });
  assert.equal(status, 200);
  assert.deepEqual(body.mergedInto, 1);
  assert.equal(fake.state.store.Transaction.find((t) => t.id === 3).category_id, 1);
  assert.equal(fake.state.store.category_rules.find((r) => r.id === 1).category_id, 1);
  assert.equal(fake.state.store.Budget[0].categoryid, 1);
  assert.equal(fake.state.store.Category.some((c) => c.id === 2), false);
  assert.equal(fake.state.store.category_rules.find((r) => r.id === 3).category_id, 9, "la regola di un altro utente resta");
});

test("merge: rifiutato verso un altro tipo, la categoria di sistema, se stessa o una categoria altrui", async () => {
  assert.equal((await call("POST", "/category/1/merge", { into_id: 3 })).status, 400, "tipi diversi");
  assert.equal((await call("POST", "/category/1/merge", { into_id: 4 })).status, 409, "sistema");
  assert.equal((await call("POST", "/category/1/merge", { into_id: 1 })).status, 400, "se stessa");
  assert.equal((await call("POST", "/category/1/merge", { into_id: 9 })).status, 404, "altrui");
  assert.equal(fake.state.store.Category.length, 5, "niente cancellato");
});

test("rules: elenco solo dell'utente, in ordine di parola", async () => {
  const { status, body } = await call("GET", "/category-rules");
  assert.equal(status, 200);
  assert.deepEqual(body.data.map((r) => r.keyword), ["coop", "lidl"]);
});

test("rules: una regola a mano si normalizza e prende il tipo della categoria", async () => {
  const { status, body } = await call("POST", "/category-rules", { keyword: "  Pànificio 24! ", category_id: 1 });
  assert.equal(status, 201);
  // il fake ignora le colonne del select: si confrontano i campi che contano
  const { keyword, type, category_id, source } = body;
  assert.deepEqual({ keyword, type, category_id, source }, { keyword: "panificio", type: "E", category_id: 1, source: "manual" });
});

test("rules: una parola gia' presente passa alla nuova categoria, senza duplicati", async () => {
  await call("POST", "/category-rules", { keyword: "LIDL", category_id: 1 });
  const mine = fake.state.store.category_rules.filter((r) => r.user_id === U1 && r.keyword === "lidl");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].category_id, 1);
});

test("rules: rifiutate su categorie altrui o di sistema, parole senza lettere", async () => {
  assert.equal((await call("POST", "/category-rules", { keyword: "bar", category_id: 9 })).status, 404);
  assert.equal((await call("POST", "/category-rules", { keyword: "bar", category_id: 4 })).status, 400);
  assert.equal((await call("POST", "/category-rules", { keyword: "1234", category_id: 1 })).status, 400);
});

test("rules: si cancella solo una regola propria", async () => {
  assert.equal((await call("DELETE", "/category-rules/3")).status, 404, "regola di un altro utente");
  assert.equal((await call("DELETE", "/category-rules/2")).status, 200);
  assert.equal(fake.state.store.category_rules.some((r) => r.id === 2), false);
});
