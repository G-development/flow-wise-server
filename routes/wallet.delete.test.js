/**
 * DELETE /wallet/:id — the two ways a wallet delete used to destroy data silently.
 *
 * Two tables reference `Wallet` and neither was accounted for by the route:
 *
 *   1. `Transaction.wallet_id` — no ON DELETE action, so the delete failed and the raw
 *      Postgres message (SQLSTATE 23503, constraint name included) reached the client
 *      inside a 400;
 *   2. `Budget.walletid` — ON DELETE CASCADE (measured on the live DB, not read from the
 *      dump), so the wallet was deleted with a 200 and its budgets disappeared with it:
 *      no error, no warning, nothing in the response.
 *
 * The guard counts both, scoped to the authenticated user, and refuses with an explicit
 * 409 that names what blocks; migration 007 moves the Budget side to RESTRICT as a
 * backstop under the guard. These tests cover the three branches the route now has —
 * in use by transactions, in use by budgets, not in use — plus the ownership and error
 * branches.
 *
 * Why the Supabase client is injected with `mock.module` instead of
 * `testutils/fakeSupabase.js`: the guard counts with `.select("id", { count: "exact",
 * head: true })` (same shape as the `DELETE /category/:id` guard), and supabase-js sends
 * that as a real `HEAD` request, which the shared in-process fake does not implement.
 * `routes/wallet.js` takes its client from `config/supabaseClient.js` at import time, so
 * the module is replaced with a facade dispatching to a per-test fake. The rest is real:
 * Express, the real router, the real `requireAuth`.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const TOKEN = "token-user-1";

const WALLET_ID = 7;

/**
 * Per-test fake, set right before each request. The mock below is registered once, at
 * import time, with a facade that forwards to whatever `activefake` holds: ESM live
 * bindings mean the facade can dispatch to a fresh fixture per test without re-importing
 * the router.
 */
let activeFake = null;

const supabaseFacade = {
  from: (...args) => activeFake.client.from(...args),
  auth: { getUser: (...args) => activeFake.client.auth.getUser(...args) },
};

mock.module("../config/supabaseClient.js", {
  exports: { supabase: supabaseFacade },
});

const express = (await import("express")).default;
const walletRouter = (await import("./wallet.js")).default;

const app = express();
app.use(express.json());
app.use("/wallet", walletRouter);
app.use((err, req, res, next) => {
  void next;
  res.status(500).json({ error: "Internal Server Error" });
});

const request = async (method, path, { token = TOKEN } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      { method, headers }
    );
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const matches = (row, filters) =>
  filters.every(({ column, value }) => String(row[column]) === String(value));

/**
 * Chainable query builder over in-memory arrays, with a call log. It emulates only what
 * this route needs: a counted `head` select on `Transaction` and `Budget`, a filtered
 * delete on `Wallet`, and `auth.getUser`. `deleteErrors` fails the delete the way the
 * real foreign key does; `countErrors` fails the count of one table only.
 */
const createFakeSupabase = ({
  wallets = [],
  transactions = [],
  budgets = [],
  deleteErrors = {},
  countErrors = {},
} = {}) => {
  const store = { Wallet: wallets, Transaction: transactions, Budget: budgets };
  const calls = [];

  const execute = (state) => {
    const rows = store[state.table] ?? [];
    const matched = rows.filter((row) => matches(row, state.filters));
    const failure = countErrors[state.table] ?? deleteErrors[state.table];

    if (failure && (state.op === "select" || state.op === "delete"))
      return { data: null, error: failure, count: null };

    if (state.op === "select") {
      return {
        data: state.options?.head === true ? null : matched,
        error: null,
        count: matched.length,
      };
    }

    if (state.op === "delete") {
      store[state.table] = rows.filter((row) => !matched.includes(row));
      return {
        data: state.wantsRepresentation ? matched : null,
        error: null,
        count: null,
      };
    }

    throw new Error(`operazione non supportata dal fake: ${state.op}`);
  };

  const from = (table) => {
    const state = { table, op: null, filters: [], options: undefined };
    calls.push(state);

    const builder = {
      select(columns, options) {
        // `.delete().select()` is one chain: `select` must not overwrite the delete.
        if (state.op === "delete") {
          state.wantsRepresentation = true;
          state.columns = columns;
          return builder;
        }
        state.op = "select";
        state.columns = columns;
        state.options = options;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(column, value) {
        state.filters.push({ column, value });
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(execute(state)).then(onFulfilled, onRejected);
      },
    };

    return builder;
  };

  return {
    client: {
      from,
      auth: {
        getUser: async (token) =>
          token === TOKEN
            ? { data: { user: { id: USER_ID } }, error: null }
            : { data: { user: null }, error: { message: "invalid token" } },
      },
    },
    store,
    calls,
  };
};

/** The guard queries, by table. The delete is a separate entry. */
const guardOps = (fake) =>
  fake.calls
    .filter((call) => call.op === "select")
    .map((call) => call.table)
    .sort();

const deleteCalls = (fake) => fake.calls.filter((call) => call.op === "delete");

const callFor = (fake, table) => fake.calls.find((call) => call.table === table);

const walletRow = (fake, id = WALLET_ID) =>
  fake.store.Wallet.find((row) => String(row.id) === String(id));

// ---------------------------------------------------------------------------
// 1. In use by transactions
// ---------------------------------------------------------------------------

test("un wallet referenziato da transazioni e' rifiutato con un 409 esplicito", async () => {
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
    transactions: [
      { id: 1, userid: USER_ID, wallet_id: WALLET_ID },
      { id: 2, userid: USER_ID, wallet_id: WALLET_ID },
      { id: 3, userid: USER_ID, wallet_id: WALLET_ID },
    ],
  });

  const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(status, 409);
  assert.equal(body.code, "WALLET_IN_USE");
  assert.equal(body.transactionCount, 3);
  assert.equal(body.budgetCount, 0);
  assert.match(body.error, /in use by 3 transactions/i);
  assert.match(body.error, /reassign or remove/i);
  assert.doesNotMatch(body.error, /0 budgets/);

  // Nothing was deleted, and the refusal is the guard's, not the database's: no raw
  // Postgres message can reach the client because the delete was never attempted.
  assert.ok(walletRow(activeFake), "il wallet sopravvive al rifiuto");
  assert.equal(activeFake.store.Transaction.length, 3);
  assert.deepEqual(guardOps(activeFake), ["Budget", "Transaction"]);
  assert.equal(deleteCalls(activeFake).length, 0);
  assert.doesNotMatch(body.error, /foreign key|violates|constraint/i);

  // Both counts are scoped to the authenticated user.
  assert.deepEqual(callFor(activeFake, "Transaction").filters, [
    { column: "userid", value: USER_ID },
    { column: "wallet_id", value: String(WALLET_ID) },
  ]);
  assert.deepEqual(callFor(activeFake, "Budget").filters, [
    { column: "userid", value: USER_ID },
    { column: "walletid", value: String(WALLET_ID) },
  ]);
});

// ---------------------------------------------------------------------------
// 2. In use by budgets (the CASCADE hole)
// ---------------------------------------------------------------------------

test("un wallet referenziato da un budget non si cancella in silenzio", async () => {
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
    budgets: [{ id: 1, userid: USER_ID, walletid: WALLET_ID }],
  });

  const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(
    status,
    409,
    "il guard deve rifiutare anche il solo riferimento da Budget"
  );
  assert.equal(body.code, "WALLET_IN_USE");
  assert.equal(body.transactionCount, 0);
  assert.equal(body.budgetCount, 1);
  assert.match(body.error, /in use by 1 budget;/i);
  assert.doesNotMatch(
    body.error,
    /0 transactions|foreign key|violates|constraint/i
  );

  // The budget is still there: no silent CASCADE.
  assert.equal(activeFake.store.Budget.length, 1);
  assert.equal(walletRow(activeFake).id, WALLET_ID);
  assert.equal(deleteCalls(activeFake).length, 0);
});

test("il rifiuto nomina transazioni e budget quando bloccano entrambi", async () => {
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
    transactions: [
      { id: 1, userid: USER_ID, wallet_id: WALLET_ID },
      { id: 2, userid: USER_ID, wallet_id: WALLET_ID },
    ],
    budgets: [
      { id: 1, userid: USER_ID, walletid: WALLET_ID },
      { id: 2, userid: USER_ID, walletid: WALLET_ID },
      { id: 3, userid: USER_ID, walletid: WALLET_ID },
    ],
  });

  const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(status, 409);
  assert.equal(body.transactionCount, 2);
  assert.equal(body.budgetCount, 3);
  assert.match(body.error, /in use by 2 transactions and 3 budgets/i);
  assert.equal(activeFake.store.Budget.length, 3);
  assert.equal(activeFake.store.Transaction.length, 2);
});

test("il conteggio non guarda i movimenti di un altro utente", async () => {
  // A transaction of another user points at the same wallet: it must not block the
  // delete, and dropping the `userid` filter from the count would change this result,
  // so the fixture is meaningful rather than decorative.
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
    transactions: [{ id: 1, userid: OTHER_USER_ID, wallet_id: WALLET_ID }],
    budgets: [{ id: 1, userid: OTHER_USER_ID, walletid: WALLET_ID }],
  });

  const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(status, 200);
  assert.equal(body.message, "Wallet deleted");

  // The wallet of the authenticated user is gone; the other user's rows are untouched.
  assert.equal(walletRow(activeFake), undefined);
  assert.equal(activeFake.store.Transaction.length, 1);
  assert.equal(activeFake.store.Budget.length, 1);
});

// ---------------------------------------------------------------------------
// 3. Not in use
// ---------------------------------------------------------------------------

test("un wallet non in uso si cancella normalmente", async () => {
  activeFake = createFakeSupabase({
    wallets: [
      { id: WALLET_ID, userid: USER_ID, name: "Main" },
      { id: 8, userid: USER_ID, name: "Altro" },
    ],
    transactions: [{ id: 1, userid: USER_ID, wallet_id: 8 }],
  });

  const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(status, 200);
  assert.equal(body.message, "Wallet deleted");
  assert.equal(body.wallet.id, WALLET_ID);

  assert.equal(walletRow(activeFake), undefined);
  assert.equal(activeFake.store.Wallet.length, 1, "l'altro wallet resta");
  assert.equal(activeFake.store.Transaction.length, 1, "i movimenti non si toccano");

  // Guard first, delete second — and the delete is filtered by owner.
  assert.deepEqual(guardOps(activeFake), ["Budget", "Transaction"]);
  const [deleted] = deleteCalls(activeFake);
  assert.ok(deleted, "la delete e' stata tentata");
  assert.deepEqual(deleted.filters, [
    { column: "id", value: String(WALLET_ID) },
    { column: "userid", value: USER_ID },
  ]);
});

test("il wallet di un altro utente non viene cancellato", async () => {
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: OTHER_USER_ID, name: "Altrui" }],
  });

  const { status } = await request("DELETE", `/wallet/${WALLET_ID}`);

  assert.equal(status, 200);
  assert.equal(activeFake.store.Wallet.length, 1, "la delete e' filtrata per userid");
});

// ---------------------------------------------------------------------------
// 4. Error branches
// ---------------------------------------------------------------------------

test("se il conteggio fallisce il wallet non viene cancellato", async () => {
  // Without a count we cannot tell whether the wallet is in use, so the safe outcome is
  // not to delete at all: this is the branch that protects the data when the database is
  // unreachable, not just the happy path.
  for (const table of ["Transaction", "Budget"]) {
    activeFake = createFakeSupabase({
      wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
      countErrors: { [table]: { code: "PGRST000", message: `${table} count unavailable` } },
    });

    const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

    assert.equal(status, 400, `count ${table} fallito`);
    assert.equal(body.error, `${table} count unavailable`);
    assert.equal(body.code, undefined);
    assert.ok(walletRow(activeFake), `il wallet sopravvive al count ${table} fallito`);
    assert.equal(deleteCalls(activeFake).length, 0);
  }
});

test("una violazione di foreign key o di restrict non arriva grezza al client", async () => {
  // Two codes, both measured against PostgreSQL 18 + PostgREST: `23503` is the FK without
  // an ON DELETE action (`Transaction_wallet_id_fkey`), `23001` is the RESTRICT of
  // migration 007 — the net under the guard would be pointless if the route then leaked the
  // raw database message in a 400.
  for (const [code, message] of [
    [
      "23503",
      'update or delete on table "Wallet" violates foreign key constraint "Transaction_wallet_id_fkey" on table "Transaction"',
    ],
    [
      "23001",
      'update or delete on table "Wallet" violates foreign key constraint "Budget_walletid_fkey" on table "Budget"',
    ],
  ]) {
    activeFake = createFakeSupabase({
      wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
      deleteErrors: { Wallet: { code, message } },
    });

    const { status, body } = await request("DELETE", `/wallet/${WALLET_ID}`);

    assert.equal(status, 409, `codice ${code}`);
    assert.equal(body.code, "WALLET_IN_USE");
    assert.doesNotMatch(body.error, /foreign key|violates|constraint/i);
    assert.ok(walletRow(activeFake), `il wallet resta dopo il rifiuto del DB (${code})`);
  }
});

test("senza token la richiesta e' respinta prima di toccare il wallet", async () => {
  activeFake = createFakeSupabase({
    wallets: [{ id: WALLET_ID, userid: USER_ID, name: "Main" }],
  });

  const noToken = await request("DELETE", `/wallet/${WALLET_ID}`, { token: null });
  assert.equal(noToken.status, 401);

  const badToken = await request("DELETE", `/wallet/${WALLET_ID}`, {
    token: "token-non-valido",
  });
  assert.equal(badToken.status, 401);

  // `requireAuth` is the real middleware: nothing reached the database.
  assert.deepEqual(activeFake.calls, []);
  assert.ok(walletRow(activeFake));
});
