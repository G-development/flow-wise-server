/**
 * Paginazione di `GET /category` e `GET /category/active`.
 *
 * Residuo della verifica indipendente t_e4652da3: dopo la paginazione di
 * `/expense/all`, `/income/all`, `/transaction/all` e `/bank/transactions`, queste
 * due route restavano una `select()` una-shot con array nudo in risposta. Oltre il
 * tetto PostgREST (1000 righe) l'elenco arrivava incompleto e **senza dirlo**: il
 * client lo mostrava come se fosse completo.
 *
 * End-to-end come gli altri test di invariante: app Express vera, router vero,
 * `requireAuth` vero, client `@supabase/supabase-js` vero; finto solo il server
 * Supabase (`testutils/fakeSupabase.js`), che emula il tetto di 1000 righe per
 * richiesta e l'header `Content-Range` da cui `supabase-js` ricava `count`.
 * Un fake senza il tetto non distinguerebbe la route che pagina da quella che non
 * pagina, cioe' non proverebbe nulla.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createClient } from "@supabase/supabase-js";
import { startFakeSupabase, FAKE_DB_MAX_ROWS } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const TOKEN1 = "token-user-1";
const TOKEN2 = "token-user-2";

const fake = await startFakeSupabase({
  users: {
    [TOKEN1]: { id: U1, email: "user1@example.com" },
    [TOKEN2]: { id: U2, email: "user2@example.com" },
  },
  tables: { Category: [] },
});

process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const categoryRouter = (await import("./category.js")).default;

const app = express();
app.use(express.json());
app.use("/category", categoryRouter);
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

const request = async (path, { token = TOKEN1 } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/**
 * Righe `1..count` per `userid`. `active: false` su una riga su tre: serve a dare
 * un senso al filtro di `/category/active` (senza righe inattive il filtro non
 * cambierebbe il risultato e il test non asserirebbe nulla).
 */
const buildCategories = (userid, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    userid,
    name: `cat ${index + 1}`,
    type: index % 2 === 0 ? "E" : "I",
    active: index % 3 !== 0,
  }));

const setCategories = (rows) => {
  fake.state.store.Category = rows;
  fake.state.requests.length = 0;
};

const ids = (rows) => rows.map((row) => row.id);

const assertAscendingIds = (rows, expectedCount) => {
  assert.equal(rows.length, expectedCount);
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].id !== index + 1) {
      throw new Error(
        `ordine non deterministico alla posizione ${index}: id ${rows[index].id}, atteso ${index + 1}`
      );
    }
  }
};

// ---------------------------------------------------------------------------
// La classe di difetto, riprodotta
// ---------------------------------------------------------------------------

test("una select una-shot si ferma al tetto di 1000 righe: e' il difetto che la route ora evita", async () => {
  setCategories(buildCategories(U1, 1500));

  const supabase = createClient(fake.url, "test-service-role-key", {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase
    .from("Category")
    .select("*")
    .eq("userid", U1);

  assert.equal(error, null);
  assert.equal(
    data.length,
    FAKE_DB_MAX_ROWS,
    "una sola richiesta non supera mai il tetto PostgREST"
  );
});

// ---------------------------------------------------------------------------
// GET /category
// ---------------------------------------------------------------------------

test("GET /category: 1500 categorie tornano tutte, truncated false", async () => {
  setCategories(buildCategories(U1, 1500));

  const { status, body } = await request("/category");

  assert.equal(status, 200);
  assert.deepEqual(
    Object.keys(body).sort(),
    ["count", "data", "total", "truncated"],
    "la risposta e' l'envelope di lista, non un array nudo"
  );
  assert.equal(body.data.length, 1500, "oltre il tetto di 1000 righe, non a 1000");
  assert.equal(body.count, 1500);
  assert.equal(body.total, 1500);
  assert.equal(body.truncated, false);
  assertAscendingIds(body.data, 1500);

  // Nessuna riga duplicata ne' saltata fra le pagine (tiebreaker univoco).
  assert.equal(new Set(ids(body.data)).size, 1500);
});

test("GET /category: 1001 righe (appena oltre il tetto) tornano tutte", async () => {
  setCategories(buildCategories(U1, 1001));

  const { status, body } = await request("/category");

  assert.equal(status, 200);
  assert.equal(body.data.length, 1001);
  assert.equal(body.count, 1001);
  assert.equal(body.total, 1001);
  assert.equal(body.truncated, false);
  assertAscendingIds(body.data, 1001);
});

test("GET /category: oltre il tetto di pagine dell'helper dichiara truncated true e il total", async () => {
  // 1005 pagine: la 101esima non viene letta (maxPages = 100), quindi il set e'
  // incompleto e la risposta deve dirlo invece di presentare un elenco parziale.
  setCategories(buildCategories(U1, 100500));

  const { status, body } = await request("/category");

  assert.equal(status, 200);
  assert.equal(body.data.length, 100000, "tetto di pagine dell'helper");
  assert.equal(body.count, 100000);
  assert.equal(body.total, 100500);
  assert.equal(body.truncated, true);
  assertAscendingIds(body.data, 100000);
});

test("GET /category: set vuoto, i campi dell'envelope ci sono comunque", async () => {
  setCategories(buildCategories(U2, 3));

  const { status, body } = await request("/category");

  assert.equal(status, 200);
  assert.deepEqual(body, { data: [], count: 0, truncated: false, total: 0 });
});

test("GET /category resta scoped al token: le categorie dell'utente 2 non compaiono", async () => {
  setCategories([...buildCategories(U2, 1200), ...buildCategories(U1, 5)]);

  const { status, body } = await request("/category");

  assert.equal(status, 200);
  assert.equal(body.data.length, 5, "solo le 5 categorie dell'utente del token");
  assert.ok(body.data.every((row) => row.userid === U1));
});

// ---------------------------------------------------------------------------
// GET /category/active
// ---------------------------------------------------------------------------

test("GET /category/active: filtra le inattive e pagina oltre 1000", async () => {
  const rows = buildCategories(U1, 1500);
  setCategories(rows);

  const { status, body } = await request("/category/active");

  const expected = rows.filter((row) => row.active).length;
  assert.equal(expected, 1000, "il fixture deve superare il tetto anche dopo il filtro");
  assert.equal(status, 200);
  assert.equal(body.data.length, expected);
  assert.equal(body.count, expected);
  assert.equal(body.total, expected);
  assert.equal(body.truncated, false);
  assert.ok(body.data.every((row) => row.active === true));
  assert.ok(body.data.every((row) => row.userid === U1));
});

test("GET /category/active: oltre il tetto di pagine dichiara truncated true", async () => {
  setCategories(buildCategories(U1, 150000));

  const { status, body } = await request("/category/active");

  assert.equal(status, 200);
  assert.equal(body.truncated, true);
  assert.equal(body.total, 100000, "le attive sono 2 su 3");
  assert.equal(body.count, 100000);
});

// ---------------------------------------------------------------------------
// Errori e autenticazione
// ---------------------------------------------------------------------------

test("errore PostgREST: 400 con il messaggio, nessuna lista parziale", async () => {
  setCategories(buildCategories(U1, 10));
  fake.state.failingTables.add("Category");

  try {
    const { status, body } = await request("/category");

    assert.equal(status, 400);
    assert.equal(body.error, "boom");
    assert.equal(body.data, undefined, "un errore non deve restituire una lista");
  } finally {
    fake.state.failingTables.delete("Category");
  }
});

test("senza token valido le due route rispondono 401", async () => {
  for (const path of ["/category", "/category/active"]) {
    assert.equal((await request(path, { token: null })).status, 401, `${path} senza token`);
    assert.equal((await request(path, { token: "forged" })).status, 401, `${path} con token falso`);
  }
});
