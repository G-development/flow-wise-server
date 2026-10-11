/**
 * Import CSV — il segno dell'importo e la normalizzazione su `routes/import.js`.
 *
 * I test sono end-to-end sulla catena vera: app Express, router vero,
 * `requireAuth` vero, client `@supabase/supabase-js` vero. L'unica cosa finta e'
 * il server Supabase (`testutils/fakeSupabase.js`).
 *
 * Cosa fissano, in ordine di importanza:
 *   1. un importo negativo (`-50,00`) significa "uscita": viene salvato in valore
 *      assoluto con `type: "E"`, mai come `amount` negativo;
 *   2. su un CSV misto **nessuna** transazione salvata ha `amount < 0` — il segno
 *      vive solo in `type`;
 *   3. la contraddizione (importo negativo + `Type "I"`) e' rifiutata con un
 *      errore esplicito invece di essere reinterpretata a posto dell'utente;
 *   4. una riga malformata produce un errore esplicito (riga + valore) e non
 *      viene scritta in silenzio;
 *   5. i separatori ambigui (`1,234`) sono rifiutati, non letti a caso.
 *
 * Il codice pre-fix falliva 1, 2, 3, 4-bis e 5: `parseFloat` nudo produceva
 * `-50` e lo inseriva cosi' com'era (nessun `Math.abs`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const TOKEN1 = "token-user-1";

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "user1@example.com" } },
  tables: { Category: [], Wallet: [], Transaction: [] },
});

// L'env va impostato PRIMA dell'import: `config/supabaseClient.js` costruisce il
// client all'import (e `dotenv` non sovrascrive variabili gia' presenti).
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const importRouter = (await import("./import.js")).default;

const app = express();
app.use(express.json());
app.use("/import", importRouter);
// Stesso error handler globale di server.js: un handler che lancia risponde 500.
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

const CSV_HEADER = "Type,Amount,Date,Category,Description";
const csvOf = (...rows) => [CSV_HEADER, ...rows].join("\n");

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN1}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/** Reimposta le tabelle a uno stato noto e azzera il registro delle richieste. */
const reset = () => {
  fake.state.store.Category = [
    { id: 10, userid: U1, name: "Spesa", type: "E" },
    { id: 11, userid: U1, name: "Stipendio", type: "I" },
  ];
  fake.state.store.Wallet = [
    { id: 1, userid: U1, name: "Principale", is_default: true },
  ];
  fake.state.store.Transaction = [];
  fake.state.requests.length = 0;
};

const saved = () => fake.state.store.Transaction;

// ---------------------------------------------------------------------------
// 1. Un importo negativo e' una spesa, salvata in valore assoluto
// ---------------------------------------------------------------------------

test("un importo negativo con Type \"E\" viene salvato in valore assoluto, type \"E\"", async () => {
  reset();

  // Le virgolette servono: la virgola decimale altrimenti e' un separatore di campo.
  const { status, body } = await post("/import/csv", {
    csv: csvOf('E,"-50,00",15/03/2024,Spesa,Spesa settimanale'),
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.deepEqual(body.errors, []);

  assert.equal(saved().length, 1);
  const [transaction] = saved();
  assert.equal(transaction.amount, 50, "il segno non resta dentro l'importo");
  assert.equal(typeof transaction.amount, "number");
  assert.equal(transaction.type, "E");
  assert.equal(transaction.category_id, 10);
  assert.equal(transaction.wallet_id, 1);
  assert.equal(transaction.userid, U1);
  assert.equal(transaction.description, "Spesa settimanale");
  assert.ok(transaction.amount >= 0);
});

test("un importo positivo non viene toccato e resta il Type dichiarato", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf("I,\"1500,00\",01/03/2024,Stipendio,Stipendio marzo"),
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(saved()[0].amount, 1500);
  assert.equal(saved()[0].type, "I");
});

// ---------------------------------------------------------------------------
// 2. CSV misto: nessuna transazione salvata con amount < 0
// ---------------------------------------------------------------------------

test("su un CSV misto nessuna transazione salvata ha amount < 0", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf(
      "I,\"1500,00\",01/03/2024,Stipendio,Stipendio marzo",
      'E,"-50,00",15/03/2024,Spesa,Spesa settimanale',
      "E,30.00,16/03/2024,Spesa,Pranzo"
    ),
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 3);
  assert.equal(body.totalRows, 3);
  assert.deepEqual(body.errors, []);

  assert.equal(saved().length, 3);
  const negatives = saved().filter((row) => row.amount < 0);
  assert.deepEqual(
    negatives,
    [],
    "nessun importo negativo: il segno sta in `type`, non nel valore"
  );
  assert.deepEqual(
    saved().map((row) => [row.amount, row.type]),
    [
      [1500, "I"],
      [50, "E"],
      [30, "E"],
    ]
  );
});

// ---------------------------------------------------------------------------
// 3. Segno che contraddice il Type: rifiuto esplicito, nessun reinterpretazione
// ---------------------------------------------------------------------------

test("un importo negativo con Type \"I\" e' rifiutato con un errore esplicito", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf(
      'I,"-50,00",15/03/2024,Stipendio,Riga contraddittoria',
      "E,30.00,16/03/2024,Spesa,Pranzo"
    ),
  });

  // La riga buona entra, quella contraddittoria no: nessun silenzio.
  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(saved().length, 1);
  assert.equal(saved()[0].amount, 30);
  assert.equal(saved()[0].type, "E");

  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0], /^Row 2: /);
  assert.match(body.errors[0], /-50,00/);
  assert.match(body.errors[0], /Type is "I"/);
  assert.doesNotMatch(body.errors[0], /undefined|NaN/);
});

test("se tutte le righe sono negative a Type \"I\" la risposta e' 400 con i dettagli", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf('I,"-50,00",15/03/2024,Stipendio,Riga contraddittoria'),
  });

  assert.equal(status, 400);
  assert.equal(body.error, "No valid transactions to import.");
  assert.equal(body.details.length, 1);
  assert.match(body.details[0], /^Row 2: /);
  assert.deepEqual(saved(), [], "nessuna scrittura silenziosa");
});

// ---------------------------------------------------------------------------
// 4. Riga malformata: errore esplicito
// ---------------------------------------------------------------------------

test("una riga malformata produce un errore esplicito e non viene scritta", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf(
      "E,30.00,16/03/2024,Spesa,Pranzo",
      "E,abc,16/03/2024,Spesa,Importo illeggibile"
    ),
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(body.totalRows, 2);
  assert.equal(saved().length, 1, "la riga malformata non finisce nel DB");

  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0], /^Row 3: /);
  assert.match(body.errors[0], /Invalid Amount "abc"/);
  assert.match(body.errors[0], /unrecognised number "abc"/);
});

test("un importo vuoto e' un errore esplicito, non uno zero", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf("E,,16/03/2024,Spesa,Senza importo"),
  });

  assert.equal(status, 400);
  assert.match(body.details[0], /^Row 2: /);
  assert.match(body.details[0], /amount is empty/);
  assert.deepEqual(saved(), []);
});

// ---------------------------------------------------------------------------
// 5. Separatori: letti quando sono leggibili, rifiutati quando sono ambigui
// ---------------------------------------------------------------------------

test("i separatori di migliaia e decimali sono letti senza inventare il valore", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf(
      // `1.234,56` (stile italiano) e `1,234.56` (stile anglosassone) valgono lo stesso.
      "E,\"1.234,56\",01/03/2024,Spesa,Formato italiano",
      "E,\"1,234.56\",02/03/2024,Spesa,Formato anglosassone",
      "E,\"1.234.567\",03/03/2024,Spesa,Migliaia senza decimali",
      'E,"-1.234,56",04/03/2024,Spesa,Negativo con migliaia'
    ),
  });

  assert.equal(status, 201);
  assert.deepEqual(body.errors, []);
  assert.deepEqual(
    saved().map((row) => [row.amount, row.type]),
    [
      [1234.56, "E"],
      [1234.56, "E"],
      [1234567, "E"],
      [1234.56, "E"],
    ]
  );
});

test("un separatore ambiguo e' rifiutato invece di essere indovinato", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: csvOf(
      "E,\"1,234\",16/03/2024,Spesa,Ambigua 1234 o 1.234",
      "E,30.00,16/03/2024,Spesa,Pranzo"
    ),
  });

  assert.equal(status, 201);
  assert.equal(body.importedCount, 1);
  assert.equal(saved().length, 1);
  assert.equal(saved()[0].amount, 30, "la riga ambigua non viene salvata con un valore a caso");

  assert.equal(body.errors.length, 1);
  assert.match(body.errors[0], /^Row 2: /);
  assert.match(body.errors[0], /ambiguous/);
});

// ---------------------------------------------------------------------------
// Contorno: intestazioni mancanti e default wallet restano errori espliciti
// ---------------------------------------------------------------------------

test("senza le colonne obbligatorie la richiesta e' rifiutata prima di leggere le righe", async () => {
  reset();

  const { status, body } = await post("/import/csv", {
    csv: "Type,Amount\nE,30.00",
  });

  assert.equal(status, 400);
  assert.equal(body.error, "Invalid CSV format");
  assert.match(body.details, /Date/);
  assert.deepEqual(saved(), []);
});

test("senza wallet di default l'import non scrive nulla e lo dice", async () => {
  reset();
  fake.state.store.Wallet = [];

  const { status, body } = await post("/import/csv", {
    csv: csvOf("E,30.00,16/03/2024,Spesa,Pranzo"),
  });

  assert.equal(status, 400);
  assert.match(body.error, /Default wallet is required/);
  assert.deepEqual(saved(), []);
});
