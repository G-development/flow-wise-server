import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCategorizationRequest,
  categorizeBankTransactions,
  extractJsonObject,
  validateAssignments,
} from "./categorizationAgent.js";

const categories = [
  { id: 1, name: "Spesa", type: "E" },
  { id: 2, name: "Altro", type: "E" },
  { id: 10, name: "Stipendio", type: "I" },
];
const items = [
  { ref: "0", type: "E", description: "ESSELUNGA MILANO", counterparty: "Esselunga", amount: -40 },
  { ref: "1", type: "I", description: "Accredito stipendio", counterparty: "ACME", amount: 1800 },
];

const fakeFetch = (content, { ok = true, status = 200 } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok, status, json: async () => ({ choices: [{ message: { content } }] }) };
  };
  return { fetchImpl, calls };
};

const withKey = async (run) => {
  const previous = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = "test-key";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previous;
  }
};

test("la richiesta separa le categorie per tipo e non contiene id del database", () => {
  const request = buildCategorizationRequest(
    [{ ...items[0], id: "uuid-segreto" }],
    categories
  );
  assert.deepEqual(request.categories.E.map((c) => c.id), [1, 2]);
  assert.deepEqual(request.categories.I.map((c) => c.id), [10]);
  assert.equal(JSON.stringify(request).includes("uuid-segreto"), false);
  assert.equal(request.transactions[0].amount, 40);
});

test("validateAssignments tiene solo categorie esistenti e del tipo del movimento", () => {
  const result = validateAssignments(
    {
      assignments: [
        { ref: "0", categoryId: 10 }, // categoria di entrata su una spesa: scartata
        { ref: "1", categoryId: 10 },
        { ref: "9", categoryId: 1 }, // ref sconosciuto: ignorato
      ],
    },
    items,
    categories
  );
  assert.equal(result.get("0"), null);
  assert.equal(result.get("1"), 10);
  assert.equal(result.has("9"), false);
});

test("validateAssignments: id inventato o null diventano null", () => {
  const result = validateAssignments(
    { assignments: [{ ref: "0", categoryId: 999 }, { ref: "1", categoryId: null }] },
    items,
    categories
  );
  assert.equal(result.get("0"), null);
  assert.equal(result.get("1"), null);
});

test("extractJsonObject ignora il blocco di ragionamento e il testo intorno", () => {
  const parsed = extractJsonObject('<think>ragiono {non json}</think>\n```json\n{"assignments":[]}\n```');
  assert.deepEqual(parsed, { assignments: [] });
  assert.throws(() => extractJsonObject("nessun json qui"));
});

test("categorizeBankTransactions: una sola chiamata per tutto il gruppo", async () => {
  const { fetchImpl, calls } = fakeFetch(
    JSON.stringify({ assignments: [{ ref: "0", categoryId: 1 }, { ref: "1", categoryId: 10 }] })
  );
  const result = await withKey(() => categorizeBankTransactions(items, categories, { fetchImpl }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(result.get("0"), 1);
  assert.equal(result.get("1"), 10);
});

test("categorizeBankTransactions lancia senza chiave, con errore HTTP o senza JSON", async () => {
  const previous = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    await assert.rejects(() => categorizeBankTransactions(items, categories, { fetchImpl: fakeFetch("{}").fetchImpl }));
  } finally {
    if (previous !== undefined) process.env.LLM_API_KEY = previous;
  }

  await withKey(async () => {
    await assert.rejects(() =>
      categorizeBankTransactions(items, categories, { fetchImpl: fakeFetch("{}", { ok: false, status: 500 }).fetchImpl })
    );
    await assert.rejects(() =>
      categorizeBankTransactions(items, categories, { fetchImpl: fakeFetch("non so").fetchImpl })
    );
  });
});

test("categorizeBankTransactions con zero movimenti non chiama il provider", async () => {
  const { fetchImpl, calls } = fakeFetch("{}");
  const result = await categorizeBankTransactions([], categories, { fetchImpl });
  assert.equal(result.size, 0);
  assert.equal(calls.length, 0);
});
