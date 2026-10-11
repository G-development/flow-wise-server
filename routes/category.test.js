import test from "node:test";
import assert from "node:assert/strict";

// `routes/category.js` builds its default router from env-backed config at import
// time; these dummies keep the suite runnable without a .env file. `dotenv` never
// overrides a variable that is already set, so a real .env still wins where it exists.
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const express = (await import("express")).default;
const { createCategoryRouter } = await import("./category.js");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

const matches = (row, filters) =>
  filters.every(({ column, value }) => String(row[column]) === String(value));

/**
 * Fake Supabase client: chainable query builder backed by in-memory arrays, plus a
 * call log. It emulates only what the route needs (a counted `head` select and a
 * filtered delete); `deleteError` fails the delete the way the real foreign key
 * does, `countError` fails the count `select` the way an unreachable database does.
 */
const createFakeSupabase = ({
  categories = [],
  transactions = [],
  deleteError = null,
  countError = null,
} = {}) => {
  const store = { Category: categories, Transaction: transactions };
  const calls = [];

  const execute = (state) => {
    const rows = store[state.table] ?? [];
    const matched = rows.filter((row) => matches(row, state.filters));

    if (state.op === "select") {
      if (countError) return { data: null, error: countError, count: null };

      return {
        data: state.options?.head === true ? null : matched,
        error: null,
        count: state.options?.count === "exact" ? matched.length : null,
      };
    }

    if (state.op === "delete") {
      if (deleteError) return { data: null, error: deleteError };
      store[state.table] = rows.filter((row) => !matches(row, state.filters));
      return { data: null, error: null };
    }

    throw new Error(`operazione non supportata dal fake: ${state.op}`);
  };

  const from = (table) => {
    const state = { table, op: null, filters: [], options: undefined };
    calls.push(state);

    const builder = {
      select(columns, options) {
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

  return { client: { from }, store, calls };
};

/** DELETE over real HTTP against the real router, with swapped-out dependencies. */
const deleteCategory = async (fake, path) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/category",
    createCategoryRouter({
      supabase: fake.client,
      auth: (req, _res, next) => {
        req.user = { id: USER_ID };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
      { method: "DELETE" }
    );
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test("cancellare una categoria in uso e' rifiutato con un messaggio esplicito", async () => {
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: USER_ID, name: "Spesa" }],
    transactions: [
      { id: 1, userid: USER_ID, category_id: 7 },
      { id: 2, userid: USER_ID, category_id: 7 },
      { id: 3, userid: USER_ID, category_id: 7 },
    ],
  });

  const { status, body } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 409);
  assert.equal(body.code, "CATEGORY_IN_USE");
  assert.equal(body.transactionCount, 3);
  assert.match(body.error, /in use by 3 transactions/i);
  assert.match(body.error, /reassign or remove/i);

  // The category and its transactions survive the refused delete.
  assert.equal(fake.store.Category.length, 1);
  assert.equal(fake.store.Category[0].id, 7);
  assert.equal(fake.store.Transaction.length, 3);

  // The refusal comes from the guard, not from a leaked database constraint: the
  // delete was never attempted, so no raw Postgres message can reach the client.
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].table, "Transaction");
  assert.equal(fake.calls[0].op, "select");
  assert.doesNotMatch(body.error, /foreign key|violates|constraint/i);
});

test("il rifiuto conta le sole transazioni dell'utente autenticato", async () => {
  // A transaction of another user points at the same category: the count must
  // ignore it. Without it the fixture has a single owner and dropping the
  // `userid` filter would not change the result, so the test would pass while
  // asserting nothing.
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: USER_ID, name: "Spesa" }],
    transactions: [
      { id: 1, userid: USER_ID, category_id: 7 },
      { id: 2, userid: OTHER_USER_ID, category_id: 7 },
    ],
  });

  const { status, body } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 409);
  assert.equal(body.transactionCount, 1, "conta solo la transazione dell'utente");
  assert.doesNotMatch(body.error, /1 transactions/);
  assert.match(body.error, /1 transaction;/);

  // Nothing is deleted, the foreign user's transaction included.
  assert.equal(fake.store.Category.length, 1);
  assert.equal(fake.store.Transaction.length, 2);
});

test("una categoria non in uso si cancella normalmente", async () => {
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: USER_ID, name: "Spesa" }],
    transactions: [{ id: 1, userid: USER_ID, category_id: 8 }],
  });

  const { status, body } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 200);
  assert.equal(body.message, "Category deleted successfully");

  assert.deepEqual(fake.store.Category, []);
  assert.equal(fake.store.Transaction.length, 1, "le transazioni non vengono toccate");

  // Guard first, delete second.
  assert.deepEqual(
    fake.calls.map((call) => `${call.table}:${call.op}`),
    ["Transaction:select", "Category:delete"]
  );
});

test("una violazione di foreign key non residua non arriva grezza al client", async () => {
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: USER_ID, name: "Spesa" }],
    deleteError: {
      code: "23503",
      message:
        'update or delete on table "Category" violates foreign key constraint "Transaction_category_id_fkey" on table "Transaction"',
    },
  });

  const { status, body } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 409);
  assert.equal(body.code, "CATEGORY_IN_USE");
  assert.doesNotMatch(body.error, /foreign key|violates|constraint/i);
  assert.equal(fake.store.Category.length, 1);
});

test("la categoria di un altro utente non viene cancellata", async () => {
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: "22222222-2222-2222-2222-222222222222", name: "Altrui" }],
  });

  const { status } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 200);
  assert.equal(fake.store.Category.length, 1, "la delete e' filtrata per userid");
});

test("se il conteggio fallisce la categoria non viene cancellata", async () => {
  // Without a count we cannot tell whether the category is in use, so the safe
  // outcome is not to delete at all: this is the branch that protects the data
  // when the database is unreachable, not just the happy path.
  const fake = createFakeSupabase({
    categories: [{ id: 7, userid: USER_ID, name: "Spesa" }],
    transactions: [{ id: 1, userid: USER_ID, category_id: 7 }],
    countError: { code: "PGRST000", message: "failed to fetch" },
  });

  const { status, body } = await deleteCategory(fake, "/category/7");

  assert.equal(status, 400);
  assert.equal(body.error, "failed to fetch");
  assert.equal(body.code, undefined);

  // No delete was attempted: the only request is the count itself.
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].table, "Transaction");
  assert.equal(fake.calls[0].op, "select");

  // The category survives.
  assert.equal(fake.store.Category.length, 1);
  assert.equal(fake.store.Category[0].id, 7);
  assert.equal(fake.store.Transaction.length, 1);
});
