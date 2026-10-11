import test from "node:test";
import assert from "node:assert/strict";

// Il modulo importa il client Supabase reale, che pretende le env a load-time.
// Nei test non si tocca la rete: bastano valori finti per importare.
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const {
  AGENT_ROWS_LIMIT,
  buildCoverage,
  fetchExpenseSlice,
  runExpenseAnalysis,
} = await import("./agents.js");

/**
 * Client Supabase finto: riproduce la semantica PostgREST che conta,
 * cioè `range(from, to)` **inclusivo su entrambi gli estremi** e la count query
 * `select(..., { count: "exact", head: true })` che non scarica righe.
 * Nessuna rete, nessuna dipendenza dal DB reale.
 */
const createFakeClient = ({
  transactions = [],
  categories = [],
  missingCount = false,
} = {}) => {
  const dataQueries = [];
  const countQueries = [];

  const matches = (row, filters) =>
    filters.every(({ op, column, value }) => {
      if (op === "eq") return row[column] === value;
      if (op === "gte") return row[column] >= value;
      if (op === "lte") return row[column] <= value;
      if (op === "in") return value.includes(row[column]);
      throw new Error(`operatore non supportato: ${op}`);
    });

  const from = (table) => {
    const state = {
      table,
      filters: [],
      order: [],
      range: null,
      head: false,
      wantsCount: false,
    };

    const execute = async () => {
      const dataset = table === "Transaction" ? transactions : categories;
      const filtered = dataset.filter((row) => matches(row, state.filters));

      if (state.head) {
        countQueries.push(state);
        return {
          data: null,
          error: null,
          count: missingCount ? null : filtered.length,
        };
      }

      dataQueries.push(state);
      const [fromIndex, toIndex] = state.range ?? [0, filtered.length - 1];
      return {
        data: filtered.slice(fromIndex, toIndex + 1),
        error: null,
        count: null,
      };
    };

    const chain = {
      eq(column, value) {
        state.filters.push({ op: "eq", column, value });
        return chain;
      },
      gte(column, value) {
        state.filters.push({ op: "gte", column, value });
        return chain;
      },
      lte(column, value) {
        state.filters.push({ op: "lte", column, value });
        return chain;
      },
      in(column, value) {
        state.filters.push({ op: "in", column, value });
        return chain;
      },
      order(column, options) {
        state.order.push({ column, options });
        return chain;
      },
      range(fromIndex, toIndex) {
        state.range = [fromIndex, toIndex];
        return chain;
      },
      // I builder Supabase sono thenable: e' l'await a eseguire la query.
      then(resolve, reject) {
        return execute().then(resolve, reject);
      },
    };

    // Fedele a supabase-js: `from(table)` espone solo i verbi (select/insert/...),
    // i filtri esistono solo DOPO il select. Un `.eq` sul builder grezzo deve
    // esplodere, altrimenti il test nasconde proprio quel bug (successo davvero).
    return {
      select(_columns, options = {}) {
        state.head = options.head === true;
        state.wantsCount = options.count === "exact";
        return chain;
      },
    };
  };

  return { client: { from }, dataQueries, countQueries };
};

/** Movimenti di prova, deterministici: importi e categorie calcolabili a mano. */
const makeTransactions = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    userid: USER_ID,
    type: "E",
    description: `movimento ${index + 1}`,
    amount: 10 + (index % 7) + 0.01,
    date: "2026-10-05",
    category_id: (index % 2) + 1,
  }));

const CATEGORIES = [
  { id: 1, name: "Alimentari" },
  { id: 2, name: "Trasporti" },
];

const PERIOD = { startDate: "2026-10-01", endDate: "2026-10-31" };
const USER_ID = "user-1";

const sliceArgs = (client, limit) => ({
  client,
  userId: USER_ID,
  ...PERIOD,
  ...(limit === undefined ? {} : { limit }),
});

test("legge esattamente `limit` righe: range(0, limit - 1), mai il periodo intero", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(1500) });

  const result = await fetchExpenseSlice(sliceArgs(fake.client));

  assert.deepEqual(fake.dataQueries[0].range, [0, AGENT_ROWS_LIMIT - 1]);
  assert.notDeepEqual(
    fake.dataQueries[0].range,
    [0, AGENT_ROWS_LIMIT],
    "range(0, limit) leggerebbe una riga in piu' del dichiarato"
  );
  assert.equal(result.rowsFetched, AGENT_ROWS_LIMIT);
  assert.equal(result.transactions.length, AGENT_ROWS_LIMIT);
  assert.equal(result.totalRows, 1500, "il totale arriva dal conteggio, non dalla pagina");
});

test("il totale del periodo viene da una count query head:true, senza scaricare righe", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(1500) });

  await fetchExpenseSlice(sliceArgs(fake.client));

  assert.equal(fake.countQueries.length, 1);
  assert.equal(fake.countQueries[0].head, true);
  assert.equal(fake.countQueries[0].wantsCount, true);
  assert.equal(
    fake.dataQueries.length,
    1,
    "una sola query dati: il totale non si ottiene leggendo tutto"
  );
  assert.deepEqual(
    fake.countQueries[0].filters,
    fake.dataQueries[0].filters,
    "dati e conteggio devono usare gli stessi filtri"
  );
});

test("periodo esattamente pari al limite: nessun falso troncamento, N == M", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(AGENT_ROWS_LIMIT) });

  const slice = await fetchExpenseSlice(sliceArgs(fake.client));
  const coverage = buildCoverage(slice);

  assert.equal(slice.rowsFetched, AGENT_ROWS_LIMIT);
  assert.equal(slice.totalRows, AGENT_ROWS_LIMIT);
  assert.equal(coverage.truncated, false);
  assert.equal(
    coverage.notice,
    `Ho analizzato ${AGENT_ROWS_LIMIT} movimenti su ${AGENT_ROWS_LIMIT} del periodo.`
  );
  assert.ok(!coverage.notice.includes("limite analizzabile"));
});

test("periodo sotto il limite: N su N senza avviso", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(500) });

  const slice = await fetchExpenseSlice(sliceArgs(fake.client));
  const coverage = buildCoverage(slice);

  assert.equal(slice.rowsFetched, 500);
  assert.equal(slice.totalRows, 500);
  assert.equal(coverage.truncated, false);
  assert.equal(coverage.notice, "Ho analizzato 500 movimenti su 500 del periodo.");
});

test("periodo vuoto: 0 su 0, non troncato", async () => {
  const fake = createFakeClient({ transactions: [] });

  const slice = await fetchExpenseSlice(sliceArgs(fake.client));
  const coverage = buildCoverage(slice);

  assert.deepEqual(slice.transactions, []);
  assert.equal(coverage.rowsFetched, 0);
  assert.equal(coverage.totalRows, 0);
  assert.equal(coverage.truncated, false);
  assert.equal(coverage.notice, "Ho analizzato 0 movimenti su 0 del periodo.");
});

test("periodo oltre il limite: dichiara N su M e segnala il troncamento", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(1500) });

  const slice = await fetchExpenseSlice(sliceArgs(fake.client));
  const coverage = buildCoverage(slice);

  assert.equal(coverage.rowsFetched, 1000);
  assert.equal(coverage.totalRows, 1500);
  assert.equal(coverage.truncated, true);
  assert.ok(
    coverage.notice.startsWith("Ho analizzato 1000 movimenti su 1500 del periodo."),
    coverage.notice
  );
  assert.ok(
    coverage.notice.includes("limite analizzabile (1000)"),
    coverage.notice
  );
  assert.ok(
    coverage.notice.includes("l'analisi copre solo i primi 1000"),
    coverage.notice
  );
});

test("il limite e' parametrizzabile (per misure piu' piccole) e coerente col dichiarato", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(7) });

  const slice = await fetchExpenseSlice(sliceArgs(fake.client, 5));
  const coverage = buildCoverage(slice);

  assert.deepEqual(fake.dataQueries[0].range, [0, 4]);
  assert.equal(slice.rowsFetched, 5);
  assert.equal(slice.totalRows, 7);
  assert.equal(coverage.truncated, true);
  assert.equal(
    coverage.notice,
    "Ho analizzato 5 movimenti su 7 del periodo. Il periodo contiene più movimenti del limite analizzabile (5): l'analisi copre solo i primi 5."
  );
});

test("limit non valido fallisce esplicitamente", async () => {
  const fake = createFakeClient({ transactions: makeTransactions(3) });

  await assert.rejects(() => fetchExpenseSlice(sliceArgs(fake.client, 0)), RangeError);
  await assert.rejects(() => fetchExpenseSlice(sliceArgs(fake.client, 1.5)), RangeError);
});

test("il numero dichiarato e' quello passato a summarizeExpensesForAI (periodo troncato)", async () => {
  const transactions = makeTransactions(1500);
  const fake = createFakeClient({ transactions, categories: CATEGORIES });
  let captured;

  const payload = await runExpenseAnalysis({
    question: "Analizza le mie spese",
    ...PERIOD,
    userId: USER_ID,
    client: fake.client,
    analyze: async (args) => {
      captured = args;
      return "Testo del modello.";
    },
  });

  assert.equal(payload.transactionsAnalyzed, 1000);
  assert.equal(payload.coverage.rowsFetched, 1000);
  assert.equal(payload.totalTransactions, 1500);
  assert.equal(payload.truncated, true);
  assert.equal(payload.limit, AGENT_ROWS_LIMIT);
  assert.deepEqual(captured.period, PERIOD);
  assert.equal(
    captured.transactions.transactionCount,
    payload.transactionsAnalyzed,
    "il riepilogo inviato al modello e il conteggio dichiarato devono coincidere"
  );
  assert.equal(
    payload.coverage.notice,
    "Ho analizzato 1000 movimenti su 1500 del periodo. Il periodo contiene più movimenti del limite analizzabile (1000): l'analisi copre solo i primi 1000."
  );
  assert.ok(
    payload.analysis.startsWith(`${payload.coverage.notice}\n\n`),
    payload.analysis
  );
  assert.ok(
    payload.analysis.startsWith("Ho analizzato 1000 movimenti su 1500 del periodo."),
    payload.analysis
  );
  assert.ok(payload.analysis.includes("l'analisi copre solo i primi 1000"));
  assert.ok(payload.analysis.endsWith("Testo del modello."));
});

test("periodo entro il limite: N su N nel testo, nessun avviso, nessun troncamento", async () => {
  const fake = createFakeClient({
    transactions: makeTransactions(400),
    categories: CATEGORIES,
  });

  const payload = await runExpenseAnalysis({
    question: "Analizza le mie spese",
    ...PERIOD,
    userId: USER_ID,
    client: fake.client,
    analyze: async () => "Testo del modello.",
  });

  assert.equal(payload.transactionsAnalyzed, 400);
  assert.equal(payload.totalTransactions, 400);
  assert.equal(payload.truncated, false);
  assert.ok(payload.analysis.startsWith("Ho analizzato 400 movimenti su 400 del periodo."));
  assert.ok(!payload.analysis.includes("limite analizzabile"));
});

test("la matematica in centesimi del riepilogo e' invariata sulla fetta analizzata", async () => {
  const transactions = makeTransactions(1500);
  const fake = createFakeClient({ transactions, categories: CATEGORIES });
  let captured;

  await runExpenseAnalysis({
    question: "Analizza le mie spese",
    ...PERIOD,
    userId: USER_ID,
    client: fake.client,
    analyze: async (args) => {
      captured = args;
      return "Testo del modello.";
    },
  });

  // Atteso calcolato a mano, in centesimi, sulle prime 1000 righe restituite.
  const analysed = transactions.slice(0, AGENT_ROWS_LIMIT);
  const expectedCents = analysed.reduce(
    (sum, row) => sum + Math.round(Math.abs(row.amount) * 100),
    0
  );

  assert.equal(captured.transactions.totalSpent, Number((expectedCents / 100).toFixed(2)));
  assert.equal(captured.transactions.transactionCount, analysed.length);
  assert.equal(
    captured.transactions.averageTransaction,
    Number((Math.round(expectedCents / analysed.length) / 100).toFixed(2))
  );
  const categorySum = captured.transactions.byCategory.reduce(
    (sum, category) => sum + Math.round(category.total * 100),
    0
  );
  assert.equal(categorySum, expectedCents, "la somma per categoria resta il totale");
});

test("count non disponibile: errore esplicito, non un'analisi presentata come completa", async () => {
  const fake = createFakeClient({
    transactions: makeTransactions(10),
    missingCount: true,
  });

  await assert.rejects(
    () =>
      runExpenseAnalysis({
        question: "Analizza le mie spese",
        ...PERIOD,
        userId: USER_ID,
        client: fake.client,
        analyze: async () => "Testo del modello.",
      }),
    (error) => error.status === 500 && /conteggiare/.test(error.message)
  );
});
