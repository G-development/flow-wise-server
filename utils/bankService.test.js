import test from "node:test";
import assert from "node:assert/strict";

// bankService.js costruisce il client Supabase all'import: senza URL/key lancerebbe.
// Qui non tocchiamo il DB, quindi bastano valori fittizi per importare il modulo.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const {
  buildAppTransactionFromBank,
  fetchAccountBalance,
  formatSyncedTransaction,
  generateMockBankTransactions,
  isMockBankModeEnabled,
  normalizeAccountBalance,
  normalizeGoCardlessTransactions,
} = await import("./bankService.js");

const withEnv = (overrides, run) => {
  const previous = {};
  for (const [name, value] of Object.entries(overrides)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test("il mock e' disabilitato di default (modalita' live)", () => {
  withEnv(
    { BANK_MOCK_ENABLED: undefined, BANK_PROVIDER: undefined },
    () => assert.equal(isMockBankModeEnabled(), false)
  );
});

test("BANK_MOCK_ENABLED abilita il mock, con true/1 (case-insensitive)", () => {
  for (const value of ["true", "TRUE", "1", "yes", "on"]) {
    withEnv(
      { BANK_MOCK_ENABLED: value },
      () => assert.equal(isMockBankModeEnabled(), true, `valore ${value}`)
    );
  }
});

test("BANK_MOCK_ENABLED=false non abilita il mock", () => {
  withEnv({ BANK_MOCK_ENABLED: "false" }, () =>
    assert.equal(isMockBankModeEnabled(), false)
  );
});

test("BANK_PROVIDER=mock abilita il mock (config esplicita documentata)", () => {
  withEnv({ BANK_MOCK_ENABLED: undefined, BANK_PROVIDER: "mock" }, () =>
    assert.equal(isMockBankModeEnabled(), true)
  );
});

test("l'opzione esplicita sovrascrive l'ambiente in entrambe le direzioni", () => {
  withEnv({ BANK_MOCK_ENABLED: undefined }, () => {
    assert.equal(isMockBankModeEnabled({ mock: true }), true);
    assert.equal(isMockBankModeEnabled({ mock: false }), false);
  });
  withEnv({ BANK_MOCK_ENABLED: "true" }, () => {
    assert.equal(isMockBankModeEnabled({ mock: false }), false);
  });
});

test("gli external_id del mock sono stabili nel tempo (nessun timestamp)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const first = generateMockBankTransactions("BANK_X", "acc_1", 25).map(
    (txn) => txn.transactionId
  );

  // Un'ora dopo: con l'ID volatile di prima qui cambierebbe tutto.
  t.mock.timers.setTime(1_700_000_000_000 + 60 * 60 * 1000);
  const second = generateMockBankTransactions("BANK_X", "acc_1", 25).map(
    (txn) => txn.transactionId
  );

  assert.equal(first.length, 25);
  assert.deepEqual(second, first);
});

test("gli external_id del mock sono univoci e non contengono millisecondi", () => {
  const transactions = generateMockBankTransactions("BANK_X", "acc_1", 25);
  const ids = transactions.map((txn) => txn.transactionId);

  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^txn_BANK_X_acc_1_mock_\d+_\d+$/);
  }
});

test("bank e conto diversi producono external_id diversi", () => {
  const a = generateMockBankTransactions("BANK_X", "acc_1", 5).map((t) => t.transactionId);
  const b = generateMockBankTransactions("BANK_Y", "acc_1", 5).map((t) => t.transactionId);
  const c = generateMockBankTransactions("BANK_X", "acc_2", 5).map((t) => t.transactionId);

  assert.equal(a.some((id) => b.includes(id)), false);
  assert.equal(a.some((id) => c.includes(id)), false);
});

test("normalizeAccountBalance sceglie un saldo disponibile valido prima degli altri", () => {
  const selected = normalizeAccountBalance([
    {
      balanceAmount: { amount: "10.00", currency: "EUR" },
      balanceType: "closingBooked",
      referenceDate: "2026-10-10",
    },
    {
      balanceAmount: { amount: "25.50", currency: "eur" },
      balanceType: "available",
      referenceDate: "2026-10-11",
      lastChangeDateTime: "2026-10-11T10:00:00Z",
    },
  ]);

  assert.deepEqual(selected, {
    amount: 25.5,
    currency: "EUR",
    type: "available",
    referenceDate: "2026-10-11",
    providerUpdatedAt: "2026-10-11T10:00:00Z",
    rawData: {
      balanceAmount: { amount: "25.50", currency: "eur" },
      balanceType: "available",
      referenceDate: "2026-10-11",
      lastChangeDateTime: "2026-10-11T10:00:00Z",
    },
  });
});

test("normalizeAccountBalance ignora saldi senza importo valido", () => {
  const selected = normalizeAccountBalance([
    { balanceAmount: { amount: "not-a-number", currency: "EUR" }, balanceType: "available" },
    { balanceAmount: { amount: "7.25", currency: "EUR" }, balanceType: "interimBooked" },
  ]);

  assert.equal(selected.amount, 7.25);
  assert.equal(selected.type, "interimBooked");
});

test("fetchAccountBalance restituisce un saldo mock solo con mock esplicito", async () => {
  const balance = await fetchAccountBalance("acc_mock", "mock_token", { mock: true });

  assert.equal(balance.amount, 2450.75);
  assert.equal(balance.currency, "EUR");
  assert.equal(balance.type, "mock");
});

test("normalizeGoCardlessTransactions conserva booked e pending invece di fonderli", () => {
  const txns = normalizeGoCardlessTransactions(
    {
      transactions: {
        booked: [
          {
            transactionId: "B1",
            bookingDate: "2026-11-01",
            transactionAmount: { amount: "-12.50", currency: "EUR" },
            remittanceInformationUnstructured: "Spesa",
            creditorName: "Negozio",
          },
        ],
        pending: [
          {
            transactionId: "P1",
            valueDate: "2026-11-04",
            transactionAmount: { amount: "-3.00", currency: "EUR" },
          },
        ],
      },
    },
    "acc"
  );

  assert.deepEqual(
    txns.map((t) => [t.transactionId, t.bookingStatus, t.amount]),
    [
      ["B1", "booked", -12.5],
      ["P1", "pending", -3],
    ]
  );
  assert.equal(txns[0].counterparty.name, "Negozio");
});

test("formatSyncedTransaction non scrive status (l'upsert non deve riportare a 'synced' gli importati)", () => {
  const row = formatSyncedTransaction(
    {
      transactionId: "B1",
      amount: -12.5,
      bookingDate: "2026-11-01",
      bookingStatus: "booked",
      purpose: "Spesa",
      counterparty: { name: "Negozio" },
    },
    { userId: "u1", bankId: "BANK", accountId: "acc" }
  );

  assert.equal("status" in row, false);
  assert.equal(row.booking_status, "booked");
  assert.equal(row.external_id, "B1");
  assert.equal(row.counterparty, "Negozio");
});

test("formatSyncedTransaction: pending resta pending, il mock senza stato e' booked", () => {
  const base = { transactionId: "X", amount: 1, bookingDate: "2026-11-01" };
  const ctx = { userId: "u1", bankId: "BANK", accountId: "acc" };
  assert.equal(formatSyncedTransaction({ ...base, bookingStatus: "pending" }, ctx).booking_status, "pending");
  assert.equal(formatSyncedTransaction(base, ctx).booking_status, "booked");
});

test("formatSyncedTransaction rifiuta un movimento senza id o con data non valida", () => {
  const ctx = { userId: "u1", bankId: "BANK", accountId: "acc" };
  assert.throws(() => formatSyncedTransaction({ amount: 1, bookingDate: "2026-11-01" }, ctx));
  assert.throws(() => formatSyncedTransaction({ transactionId: "X", amount: 1, bookingDate: "boh" }, ctx));
});

test("buildAppTransactionFromBank: importo assoluto, tipo dal segno, collegamento al movimento", () => {
  const bankTxn = {
    id: "bank-uuid-1",
    bank_id: "BANK",
    amount: "-42.10",
    date: "2026-11-01",
    description: "",
    counterparty: "Negozio",
  };
  const row = buildAppTransactionFromBank(bankTxn, { userId: "u1", walletId: "7", categoryId: 3 });

  assert.equal(row.amount, 42.1);
  assert.equal(row.type, "E");
  assert.equal(row.wallet_id, 7);
  assert.equal(row.category_id, 3);
  assert.equal(row.bank_transaction_id, "bank-uuid-1");
  assert.equal(row.description, "Negozio");
  assert.equal(
    buildAppTransactionFromBank({ ...bankTxn, amount: 5 }, { userId: "u1", walletId: 7, categoryId: 3 }).type,
    "I"
  );
});
