import test from "node:test";
import assert from "node:assert/strict";

// bankService.js e bankAutoImport.js costruiscono un client Supabase all'import.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  clampLimit,
  findFallbackCategories,
  resolveCategories,
  runAutoImport,
} = await import("./bankAutoImport.js");

/**
 * Client finto minimo: registra ogni richiesta (tabella, operazione, filtri) e risponde
 * con `respond(request)`. Basta per verificare il flusso di runAutoImport senza DB.
 */
const fakeClient = (respond) => {
  const requests = [];
  const from = (table) => {
    const request = { table, op: "select", filters: [], payload: null, options: null };
    const builder = {
      select(columns, options) {
        if (request.op === "select") request.columns = columns;
        request.selectOptions = options;
        return builder;
      },
      update(payload) { request.op = "update"; request.payload = payload; return builder; },
      upsert(payload, options) { request.op = "upsert"; request.payload = payload; request.options = options; return builder; },
      eq(column, value) { request.filters.push(["eq", column, value]); return builder; },
      gte(column, value) { request.filters.push(["gte", column, value]); return builder; },
      in(column, value) { request.filters.push(["in", column, value]); return builder; },
      not(column, op, value) { request.filters.push(["not", column, op, value]); return builder; },
      order() { return builder; },
      limit(value) { request.limit = value; return builder; },
      maybeSingle() { request.single = true; return builder; },
      then(resolve, reject) {
        requests.push(request);
        return Promise.resolve(respond(request)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from }, requests };
};

const connection = {
  user_id: "u1",
  bank_id: "BANK",
  account_id: "acc",
  import_wallet_id: 7,
  auto_import_from: "2026-08-07",
};
const bankRows = [
  { id: "b1", bank_id: "BANK", amount: -40, date: "2026-08-10", description: "ESSELUNGA", counterparty: "" },
  { id: "b2", bank_id: "BANK", amount: 1800, date: "2026-08-27", description: "STIPENDIO", counterparty: "" },
];
const categories = [
  { id: 1, name: "Spesa", type: "E", active: true },
  { id: 2, name: "Altro", type: "E", active: true },
  { id: 3, name: " altro ", type: "I", active: true },
];

const standardResponder = ({ remainingAfter = 0, insertedIds = ["t1", "t2"], rules = [] } = {}) => (request) => {
  if (request.table === "bank_connections") return { data: [connection], error: null };
  if (request.table === "Wallet") return { data: { id: 7 }, error: null };
  if (request.table === "Category") return { data: categories, error: null };
  if (request.table === "category_rules") return { data: rules, error: null };
  if (request.table === "bank_transactions" && request.op === "select") {
    if (request.selectOptions?.head) return { count: remainingAfter, error: null };
    return { data: bankRows, error: null };
  }
  if (request.table === "Transaction" && request.op === "upsert") {
    return { data: insertedIds.map((id) => ({ id })), error: null };
  }
  if (request.table === "bank_transactions" && request.op === "update") return { data: null, error: null };
  throw new Error(`richiesta inattesa: ${request.table} ${request.op}`);
};

test("findFallbackCategories trova 'Altro' attiva per tipo, ignorando maiuscole e spazi", () => {
  assert.deepEqual(findFallbackCategories(categories), { I: 3, E: 2 });
  assert.deepEqual(
    findFallbackCategories([{ id: 9, name: "Altro", type: "E", active: false }]),
    { I: null, E: null }
  );
});

test("resolveCategories: regola se trovata, altrimenti Altro del tipo, altrimenti nessuna", () => {
  const resolved = resolveCategories(bankRows, new Map([["0", 1], ["1", null]]), { I: 3, E: 2 });
  assert.deepEqual(resolved.map((r) => [r.categoryId, r.source]), [[1, "rule"], [3, "fallback"]]);

  const none = resolveCategories(bankRows, new Map(), { I: null, E: 2 });
  assert.deepEqual(none.map((r) => [r.categoryId, r.source]), [[2, "fallback"], [null, "none"]]);
});

test("clampLimit: default 50, massimo 100, valori non validi tornano al default", () => {
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit("10"), 10);
  assert.equal(clampLimit("1000"), 100);
  assert.equal(clampLimit("-3"), 50);
});

test("runAutoImport legge solo movimenti synced, booked e dalla data configurata", async () => {
  const { client, requests } = fakeClient(standardResponder());
  await runAutoImport({ client, categorize: () => new Map([["0", 1], ["1", 3]]) });

  const read = requests.find((r) => r.table === "bank_transactions" && r.op === "select" && !r.selectOptions?.head);
  assert.deepEqual(
    read.filters,
    [
      ["eq", "user_id", "u1"],
      ["eq", "bank_id", "BANK"],
      ["eq", "account_id", "acc"],
      ["eq", "status", "synced"],
      ["eq", "booking_status", "booked"],
      ["gte", "date", "2026-08-07"],
    ]
  );
});

test("runAutoImport inserisce con collegamento e ON CONFLICT, poi segna imported", async () => {
  const { client, requests } = fakeClient(standardResponder());
  const summary = await runAutoImport({ client, categorize: () => new Map([["0", 1], ["1", 3]]) });

  const upsert = requests.find((r) => r.table === "Transaction");
  assert.deepEqual(upsert.options, { onConflict: "bank_transaction_id", ignoreDuplicates: true });
  assert.deepEqual(upsert.payload.map((t) => [t.bank_transaction_id, t.category_id, t.type, t.wallet_id]), [
    ["b1", 1, "E", 7],
    ["b2", 3, "I", 7],
  ]);

  const mark = requests.find((r) => r.table === "bank_transactions" && r.op === "update");
  assert.deepEqual(mark.payload, { status: "imported" });
  assert.deepEqual(mark.filters.find((f) => f[0] === "in")[2], ["b1", "b2"]);

  assert.equal(summary.imported, 2);
  assert.equal(summary.byRule, 2);
  assert.equal(summary.remaining, 0);
  assert.deepEqual(summary.errors, []);
});

test("runAutoImport usa le regole locali dell'utente, senza servizi esterni", async () => {
  const rules = [{ keyword: "esselunga", type: "E", category_id: 1, updated_at: "2026-11-01" }];
  const { client, requests } = fakeClient(standardResponder({ rules }));
  const summary = await runAutoImport({ client });

  const rulesRead = requests.find((r) => r.table === "category_rules");
  assert.deepEqual(rulesRead.filters, [["eq", "user_id", "u1"]]);
  const upsert = requests.find((r) => r.table === "Transaction");
  // ESSELUNGA -> regola (Spesa, 1); STIPENDIO senza regola -> Altro entrate (3)
  assert.deepEqual(upsert.payload.map((t) => t.category_id), [1, 3]);
  assert.equal(summary.byRule, 1);
  assert.equal(summary.byFallback, 1);
  assert.deepEqual(summary.errors, []);
});

test("runAutoImport conta come gia' importati i movimenti ignorati dal conflitto", async () => {
  const { client } = fakeClient(standardResponder({ insertedIds: ["t1"] }));
  const summary = await runAutoImport({ client, categorize: () => new Map() });
  assert.equal(summary.imported, 1);
  assert.equal(summary.alreadyImported, 1);
});

test("runAutoImport riporta remaining per far richiamare il workflow", async () => {
  const { client } = fakeClient(standardResponder({ remainingAfter: 30 }));
  const summary = await runAutoImport({ client, categorize: () => new Map() });
  assert.equal(summary.remaining, 30);
});

test("runAutoImport non importa su un wallet di un altro utente", async () => {
  const responder = standardResponder();
  const { client, requests } = fakeClient((request) =>
    request.table === "Wallet" ? { data: null, error: null } : responder(request)
  );
  const summary = await runAutoImport({ client, categorize: () => new Map() });

  assert.equal(requests.some((r) => r.table === "Transaction"), false);
  assert.equal(summary.errors[0].step, "import");
});
