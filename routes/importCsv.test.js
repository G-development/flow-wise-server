/**
 * Invariante 4 — l'import CSV rifiuta gli input non validi invece di importarli:
 * colonne obbligatorie mancanti, riga con `Type` invalido, categoria di tipo
 * sbagliato, data non `dd/MM/yyyy`, categoria inesistente, file vuoto o senza
 * righe. In ogni caso di rifiuto **nessuna transazione raggiunge il DB**.
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

const baseline = () => ({
  Category: [
    { id: 1, userid: U1, name: "Food", type: "E", active: true },
    { id: 2, userid: U1, name: "Salary", type: "I", active: true },
    { id: 3, userid: U2, name: "Food", type: "E", active: true },
  ],
  Wallet: [
    { id: 10, userid: U1, name: "Default", is_default: true, opening_balance_cents: 0 },
    { id: 20, userid: U2, name: "Default", is_default: true, opening_balance_cents: 0 },
  ],
  Transaction: [],
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
const importRouter = (await import("./import.js")).default;

const app = express();
app.use(express.json());
app.use("/import", importRouter);
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

const importCsv = (csv, { token = TOKEN1 } = {}) =>
  request("POST", "/import/csv", { token, body: { csv } });

const seed = () => {
  for (const [table, rows] of Object.entries(baseline())) {
    fake.state.store[table] = rows;
  }
  fake.state.requests.length = 0;
};

test.beforeEach(seed);

const storedTransactions = () => fake.state.store.Transaction;

const insertsAttempted = () =>
  fake.restRequests().filter(
    (request) => request.path === "/rest/v1/Transaction" && request.method === "POST"
  );

/** Una data ISO valida che, riletta nel fuso locale, e' il giorno atteso. */
const assertLocalDate = (isoDate, [year, month, day]) => {
  const date = new Date(isoDate);
  assert.equal(Number.isNaN(date.getTime()), false, `data non valida: ${isoDate}`);
  assert.deepEqual([date.getFullYear(), date.getMonth() + 1, date.getDate()], [year, month, day]);
};

const HEADERS = "Type,Amount,Date,Category,Description";

// ---------------------------------------------------------------------------
// Import valido (baseline: gli altri casi sono rifiuti per confronto)
// ---------------------------------------------------------------------------

test("un CSV valido importa la riga, a nome dell'utente del token", async () => {
  const { status, body } = await importCsv(`${HEADERS}\nE,50.00,05/01/2026,Food,Groceries`);

  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.importedCount, 1);
  assert.equal(body.totalRows, 1);
  assert.deepEqual(body.errors, []);

  assert.equal(storedTransactions().length, 1);
  const [created] = storedTransactions();
  assert.equal(created.userid, U1, "il proprietario viene dal token");
  assert.equal(created.wallet_id, 10, "il wallet di default dell'utente");
  assert.equal(created.category_id, 1);
  assert.equal(created.type, "E");
  assert.equal(created.amount, 50);
  assert.equal(created.description, "Groceries");
  assertLocalDate(created.date, [2026, 1, 5]);
});

test("un CSV con delimitatore ';' e virgola decimale viene comunque importato", async () => {
  const { status, body } = await importCsv(
    "Type;Amount;Date;Category;Description\nE;50,00;05/01/2026;Food;Spesa"
  );

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(storedTransactions()[0].amount, 50);
});

// ---------------------------------------------------------------------------
// Rifiuti: nessuna transazione deve raggiungere il DB
// ---------------------------------------------------------------------------

test("colonne obbligatorie mancanti: rifiuto con l'elenco delle colonne", async () => {
  const { status, body } = await importCsv("Type,Amount\nE,50.00");

  assert.equal(status, 400);
  assert.equal(body.error, "Invalid CSV format");
  assert.match(body.details, /Date/);
  assert.match(body.details, /Category/);
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

test("riga con Type invalido: rifiuto, nessun insert", async () => {
  const { status, body } = await importCsv(`${HEADERS}\nX,50.00,05/01/2026,Food,Spesa`);

  assert.equal(status, 400);
  assert.match(body.error, /No valid transactions to import/);
  assert.match(body.details.join("\n"), /Row 2: Invalid Type "X"/);
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

test("categoria di tipo sbagliato: rifiuto, nessun insert", async () => {
  // "Food" e' una categoria di spesa (E): usarla con Type "I" e' un errore.
  const { status, body } = await importCsv(`${HEADERS}\nI,100.00,05/01/2026,Food,Stipendio`);

  assert.equal(status, 400);
  assert.match(body.error, /No valid transactions to import/);
  assert.match(body.details.join("\n"), /is not valid for type "I"/);
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

const BAD_DATES = [
  ["formato ISO invece di dd/MM/yyyy", "2026-01-05"],
  ["separatore sbagliato", "05-01-2026"],
  ["giorno inesistente", "31/02/2026"],
];

for (const [label, date] of BAD_DATES) {
  test(`data non dd/MM/yyyy (${label}): rifiuto, nessun insert`, async () => {
    const { status, body } = await importCsv(`${HEADERS}\nE,50.00,${date},Food,Spesa`);

    assert.equal(status, 400);
    assert.match(body.error, /No valid transactions to import/);
    assert.match(body.details.join("\n"), /Expected format: dd\/MM\/yyyy/);
    assert.equal(storedTransactions().length, 0);
    assert.equal(insertsAttempted().length, 0);
  });
}

test("categoria inesistente: rifiuto, nessun insert", async () => {
  const { status, body } = await importCsv(`${HEADERS}\nE,50.00,05/01/2026,Ghost,Spesa`);

  assert.equal(status, 400);
  assert.match(body.error, /No valid transactions to import/);
  assert.match(body.details.join("\n"), /does not exist/);
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

test("file vuoto: rifiutato dalla validazione, nessun insert", async () => {
  const { status, body } = await importCsv("");

  assert.equal(status, 400);
  assert.equal(body.error, "Validation error");
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

test("file con soli separatori di riga: rifiutato, nessun insert", async () => {
  const { status, body } = await importCsv("\n\n");

  assert.equal(status, 400);
  assert.equal(body.error, "Invalid CSV format");
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

test("CSV con sole intestazioni: rifiutato, nessun insert", async () => {
  const { status, body } = await importCsv(HEADERS);

  assert.equal(status, 400);
  assert.match(body.error, /No valid transactions to import/);
  assert.equal(storedTransactions().length, 0);
  assert.equal(insertsAttempted().length, 0);
});

// ---------------------------------------------------------------------------
// Import misto e isolamento
// ---------------------------------------------------------------------------

test("riga valida + riga invalida: importa solo la valida e dichiara l'errore", async () => {
  const { status, body } = await importCsv(
    `${HEADERS}\nE,50.00,05/01/2026,Food,Valida\nE,10.00,05/01/2026,Food,\n`
  );

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(body.totalRows, 2);
  assert.equal(body.errors.length, 1, "la riga senza Description viene dichiarata, non taciuta");
  assert.match(body.errors.join("\n"), /Row 3/);

  assert.equal(storedTransactions().length, 1, "solo la riga valida viene scritta");
  assert.equal(storedTransactions()[0].description, "Valida");
  assert.equal(storedTransactions()[0].userid, U1);
});

test("l'import usa la categoria dell'utente del token, non quella omonima altrui", async () => {
  // L'utente 2 ha una categoria "Food" (id 3): non deve essere usata per l'utente 1.
  const { status, body } = await importCsv(`${HEADERS}\nE,50.00,05/01/2026,Food,Spesa`, {
    token: TOKEN2,
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);

  const [created] = storedTransactions();
  assert.equal(created.userid, U2);
  assert.equal(created.category_id, 3, "la categoria omonima dell'utente 2");
  assert.equal(created.wallet_id, 20, "il wallet di default dell'utente 2");
});
