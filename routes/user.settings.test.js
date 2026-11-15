/**
 * Impostazioni utente (16/11/2026): GET / PUT /users/settings, giorno di inizio del mese.
 *
 * Invarianti:
 *   - non scelto = null (anche senza riga Profile);
 *   - si accettano solo interi 1–31;
 *   - il salvataggio tocca solo il Profile dell'utente del token e tiene le altre chiavi di `settings`;
 *   - un account senza Profile ne riceve uno al primo salvataggio.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const U3 = "33333333-3333-3333-3333-333333333333";
const T1 = "token-1";
const T3 = "token-3";

const baseline = () => ({
  Profile: [
    { id: U1, name: "a", settings: { notifications: false } },
    { id: U2, name: "b", settings: { monthStartDay: 10 } },
  ],
});

const fake = await startFakeSupabase({
  users: { [T1]: { id: U1, email: "one@example.com" }, [T3]: { id: U3, email: "three@example.com" } },
  tables: baseline(),
});
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";

const express = (await import("express")).default;
const userRouter = (await import("./user.js")).default;
const { readMonthStartDay, mergeSettings } = await import("../utils/userSettings.js");

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
});

const call = (method, body, token = T1) =>
  fetch(`${baseUrl}/users/settings`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const profile = (id) => fake.state.store.Profile.find((p) => p.id === id);

test("readMonthStartDay: solo interi 1–31", () => {
  assert.equal(readMonthStartDay({ monthStartDay: 1 }), 1);
  assert.equal(readMonthStartDay({ monthStartDay: 31 }), 31);
  for (const bad of [0, 32, 2.5, "10", null]) assert.equal(readMonthStartDay({ monthStartDay: bad }), null);
  assert.equal(readMonthStartDay(null), null);
  assert.equal(readMonthStartDay({}), null);
});

test("mergeSettings tiene le altre chiavi", () => {
  assert.deepEqual(mergeSettings({ notifications: false }, { monthStartDay: 5 }), { notifications: false, monthStartDay: 5 });
  assert.deepEqual(mergeSettings(null, { monthStartDay: 5 }), { monthStartDay: 5 });
  assert.deepEqual(mergeSettings([1], { monthStartDay: 5 }), { monthStartDay: 5 });
});

test("GET: non scelto = null; senza token 401", async () => {
  const res = await call("GET");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { monthStartDay: null });
  assert.equal((await call("GET", null, null)).status, 401);
});

test("GET senza riga Profile: null", async () => {
  assert.deepEqual(await (await call("GET", null, T3)).json(), { monthStartDay: null });
});

test("PUT: salva, tiene le altre chiavi e tocca solo l'utente del token", async () => {
  const res = await call("PUT", { monthStartDay: 27 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { monthStartDay: 27 });
  assert.deepEqual(profile(U1).settings, { notifications: false, monthStartDay: 27 });
  assert.deepEqual(profile(U2).settings, { monthStartDay: 10 }, "l'altro utente resta com'era");
  for (const r of fake.restRequests().filter((r) => r.path.endsWith("/Profile"))) {
    assert.equal(r.params.id, `eq.${U1}`, "ogni lettura e scrittura filtra per l'utente del token");
  }
  assert.deepEqual(await (await call("GET")).json(), { monthStartDay: 27 });
});

test("PUT: valori non validi 400, niente salvato", async () => {
  for (const monthStartDay of [0, 32, 1.5, "5", null]) {
    assert.equal((await call("PUT", { monthStartDay })).status, 400, `rifiuta ${JSON.stringify(monthStartDay)}`);
  }
  assert.equal((await call("PUT", {})).status, 400);
  assert.deepEqual(profile(U1).settings, { notifications: false });
});

test("PUT senza riga Profile: la crea con il giorno scelto", async () => {
  const res = await call("PUT", { monthStartDay: 31 }, T3);
  assert.equal(res.status, 200);
  const created = profile(U3);
  assert.ok(created);
  assert.deepEqual(created.settings, { monthStartDay: 31 });
  assert.equal(created.email, "three@example.com");
});
