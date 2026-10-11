import test from "node:test";
import assert from "node:assert/strict";

// `walletService.js` importa `config/supabaseClient.js`, che lancia se le env
// mancano. Il client reale non viene mai usato — le query sono iniettate con
// `{ client }` — quindi lo stub serve solo a far caricare il modulo. `??=` non
// tocca un `.env` presente (dotenv non sovrascrive variabili già impostate).
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";

const { sumBalancesInCents } = await import("./walletService.js");

/**
 * Finta query Supabase: riproduce la catena usata da `sumBalancesInCents`
 * (`from().select().eq().order().range()`) e taglia il dataset come farebbe
 * PostgREST, cioè con `.range(from, to)` inclusivo su entrambi gli estremi.
 * Nessuna rete, nessun client reale.
 */
const fakeClient = (transactions = [], { failOnPage = null } = {}) => {
  let call = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: async (from, to) => {
              const page = call;
              call += 1;
              if (page === failOnPage) {
                return { data: null, error: { message: "boom" } };
              }
              return { data: transactions.slice(from, to + 1), error: null };
            },
          }),
        }),
      }),
    }),
  };
};

const wallet = (id, opening_balance_cents) => ({
  id,
  name: `wallet-${id}`,
  opening_balance_cents,
});

const income = (wallet_id, amount) => ({ wallet_id, amount, type: "I" });
const expense = (wallet_id, amount) => ({ wallet_id, amount, type: "E" });

// Cifre reali del progetto live, così il test parla della stessa aritmetica che
// il verifier controlla sul DB: Trade Republic (apertura 2150.00, movimenti
// +1850.00, stored 4000.00) e GC Default wallet (apertura 13264.23, movimenti
// -13264.23, stored 0.00).
test("wallet con storico completo: apertura + movimenti (Trade Republic)", async () => {
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(11, 215000)],
    { client: fakeClient([income(11, 1000), income(11, 800), income(11, 50)]) }
  );

  assert.equal(balances.get("11"), 400000, "4000.00 EUR, il valore stored");
});

test("wallet con storico importato: l'apertura copre i movimenti mancanti (GC Default wallet)", async () => {
  const movements = [-5000.5, -8000, -263.73];
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(1, 1326423)],
    { client: fakeClient(movements.map((amount) => expense(1, Math.abs(amount)))) }
  );

  assert.equal(balances.get("1"), 0, "0.00 EUR, non -13264.23");
});

test("wallet senza movimenti: il saldo è l'apertura (anche negativa)", async () => {
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(10, 0), wallet(2, -100000)],
    { client: fakeClient([]) }
  );

  assert.equal(balances.get("10"), 0);
  assert.equal(balances.get("2"), -100000, "un'apertura negativa non viene assolutizzata");
  assert.equal(balances.size, 2, "anche i wallet senza movimenti entrano nel risultato");
});

test("più wallet: ogni saldo parte dalla propria apertura, non da zero", async () => {
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(1, 1326423), wallet(11, 215000), wallet(12, 0)],
    {
      client: fakeClient([
        expense(1, 13264.23),
        income(11, 1850),
        expense(12, 30),
        income(12, 12.5),
      ]),
    }
  );

  assert.deepEqual(
    [...balances.entries()],
    [
      ["1", 0],
      ["11", 400000],
      ["12", -1750],
    ]
  );
});

test("la somma pagina oltre il tetto di 1000 righe partendo dall'apertura", async () => {
  const transactions = Array.from({ length: 1500 }, () => income(7, 1));
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(7, 2500)],
    { client: fakeClient(transactions) }
  );

  assert.equal(balances.get("7"), 2500 + 150000);
});

test("il tipo E sottrae e un importo non numerico vale 0", async () => {
  const balances = await sumBalancesInCents(
    "user-1",
    [wallet(3, 0)],
    { client: fakeClient([income(3, 100), expense(3, 40), income(3, "boh")]) }
  );

  assert.equal(balances.get("3"), 6000);
});

test("un'apertura mancante fallisce invece di tornare a sommare da zero", async () => {
  await assert.rejects(
    () => sumBalancesInCents("user-1", [{ id: 4, name: "wallet-4" }], { client: fakeClient([]) }),
    /opening_balance_cents/
  );
  await assert.rejects(
    () => sumBalancesInCents("user-1", [wallet(4, null)], { client: fakeClient([]) }),
    /opening_balance_cents/
  );
  await assert.rejects(
    () => sumBalancesInCents("user-1", [wallet(4, 12.5)], { client: fakeClient([]) }),
    /non intero/
  );
});

test("wallets deve essere un array: nessun default silenzioso a lista vuota", async () => {
  await assert.rejects(() => sumBalancesInCents("user-1"), TypeError);
  await assert.rejects(
    () => sumBalancesInCents("user-1", {}, { client: fakeClient() }),
    TypeError
  );
});

test("un errore PostgREST non restituisce un saldo parziale", async () => {
  await assert.rejects(
    () => sumBalancesInCents("user-1", [wallet(1, 1326423)], { client: fakeClient([], { failOnPage: 0 }) }),
    /boom/
  );
});

test("nessun wallet: risultato vuoto", async () => {
  const balances = await sumBalancesInCents("user-1", [], { client: fakeClient([]) });

  assert.equal(balances.size, 0);
});
