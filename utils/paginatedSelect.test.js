import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchAllRows,
  toListResponse,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
} from "./paginatedSelect.js";

/**
 * Finta query Supabase: usa `.range(from, to)` come farebbe PostgREST, cioè
 * inclusivo su entrambi gli estremi. Nessuna rete, nessun client reale.
 */
const fakeQuery = (dataset, { count = null, failOnPage = null } = {}) => {
  let call = 0;
  return () => ({
    range: async (from, to) => {
      const page = call;
      call += 1;
      if (failOnPage === page) {
        return { data: null, error: { message: "boom" }, count: null };
      }
      return { data: dataset.slice(from, to + 1), error: null, count };
    },
  });
};

const range = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

test("legge tutte le pagine quando il set supera una pagina", async () => {
  const result = await fetchAllRows(fakeQuery(range(2500)));

  assert.equal(result.rows.length, 2500);
  assert.equal(result.rows[0].id, 1);
  assert.equal(result.rows[2499].id, 2500);
  assert.equal(result.count, 2500);
  assert.equal(result.truncated, false);
  assert.equal(result.pagesFetched, 3);
  assert.equal(result.total, null);
});

test("una pagina esattamente piena e completa non e' troncata", async () => {
  const result = await fetchAllRows(fakeQuery(range(DEFAULT_PAGE_SIZE)));

  assert.equal(result.rows.length, DEFAULT_PAGE_SIZE);
  assert.equal(result.truncated, false);
  assert.equal(result.pagesFetched, 2, "serve una pagina in piu' per sapere che il set e' finito");
});

test("set vuoto: nessuna riga, non troncato", async () => {
  const result = await fetchAllRows(fakeQuery([]));

  assert.deepEqual(result.rows, []);
  assert.equal(result.truncated, false);
  assert.equal(result.count, 0);
  assert.equal(result.pagesFetched, 1);
});

test("oltre maxPages con l'ultima pagina piena -> truncated true", async () => {
  const result = await fetchAllRows(fakeQuery(range(3000)), { maxPages: 2 });

  assert.equal(result.rows.length, 2000);
  assert.equal(result.truncated, true);
  assert.equal(result.pagesFetched, 2);
});

test("set pari a maxPages * pageSize -> truncated true (limite superiore noto)", async () => {
  const result = await fetchAllRows(fakeQuery(range(2000)), { maxPages: 2 });

  assert.equal(result.rows.length, 2000);
  assert.equal(result.truncated, true);
});

test("pageSize piu' piccolo pagina davvero", async () => {
  const result = await fetchAllRows(fakeQuery(range(10)), { pageSize: 3 });

  assert.equal(result.rows.length, 10);
  assert.equal(result.truncated, false);
  assert.equal(result.pagesFetched, 4);
});

test("total viene da select(..., { count: 'exact' })", async () => {
  const result = await fetchAllRows(fakeQuery(range(2500), { count: 1315 }));

  assert.equal(result.count, 2500);
  assert.equal(result.total, 1315);
  assert.equal(result.truncated, false);
});

test("un errore PostgREST a meta' paginazione non restituisce un set parziale", async () => {
  await assert.rejects(
    () => fetchAllRows(fakeQuery(range(2500), { failOnPage: 1 })),
    /boom/
  );
});

test("argomenti non validi falliscono esplicitamente", async () => {
  await assert.rejects(() => fetchAllRows(null), TypeError);
  await assert.rejects(() => fetchAllRows(() => ({}), { pageSize: 0 }), RangeError);
  await assert.rejects(() => fetchAllRows(() => ({}), { maxPages: 1.5 }), RangeError);
});

test("toListResponse produce l'envelope del contratto", () => {
  const payload = toListResponse({
    rows: [{ id: 1 }],
    truncated: true,
    count: 1,
    total: 1315,
  });

  assert.deepEqual(payload, {
    data: [{ id: 1 }],
    count: 1,
    truncated: true,
    total: 1315,
  });
});

test("toListResponse: campi derivati, rowsKey personalizzato, total assente -> null", () => {
  const payload = toListResponse({ rows: [{ id: 1 }, { id: 2 }] });

  assert.deepEqual(payload, {
    data: [{ id: 1 }, { id: 2 }],
    count: 2,
    truncated: false,
    total: null,
  });

  const bank = toListResponse({ rows: [] }, { rowsKey: "transactions" });
  assert.deepEqual(bank, {
    transactions: [],
    count: 0,
    truncated: false,
    total: null,
  });
});

test("i default sono quelli documentati", () => {
  assert.equal(DEFAULT_PAGE_SIZE, 1000);
  assert.equal(DEFAULT_MAX_PAGES, 100);
});
