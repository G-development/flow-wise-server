import test from "node:test";
import assert from "node:assert/strict";

// bankService.js costruisce il client Supabase all'import: senza URL/key lancerebbe.
// Qui non tocchiamo il DB, quindi bastano valori fittizi per importare il modulo.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { generateMockBankTransactions, isMockBankModeEnabled } = await import(
  "./bankService.js"
);

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
