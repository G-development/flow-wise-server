/**
 * Backfill del saldo di apertura dei wallet (`Wallet.opening_balance_cents`).
 *
 * Perche' esiste: il saldo di un wallet e' derivato dalle transazioni
 * (`utils/walletService.js`, `sumBalancesInCents`). Con uno storico importato manca il punto
 * di partenza, quindi la somma parte da zero e il saldo scende sotto zero. Questo script
 * assegna a ogni wallet esistente un'apertura esplicita e tracciata:
 *
 *     opening_balance_cents = round(Wallet.balance * 100) - somma_movimenti_in_centesimi
 *
 * cioe' il `balance` memorizzato oggi, il miglior valore noto del wallet. Nessun wallet con un
 * `balance` diverso dalla somma dei movimenti resta a 0: i valori assegnati sono stampati uno
 * per riga. Se `balance` e' NULL l'apertura non e' calcolabile e viene posta a
 * `-somma_movimenti` (il wallet legge 0.00): la riga e' marcata NON CALCOLABILE e va corretta
 * a mano dalla pagina /wallets.
 *
 * La stessa regola e' scritta in SQL in `migrations/003_wallet_opening_balance.sql`, che e' la
 * migrazione da eseguire per prima (crea la colonna). Questo script e' la versione da terminale:
 * dry-run di default, `--apply` per scrivere, idempotente (una seconda esecuzione non tocca nulla).
 *
 * STORICO: da `migrations/005_drop_wallet_balance.sql` la colonna `Wallet.balance` non esiste
 * piu', quindi questo script non ha piu' nulla da cui derivare l'apertura e si ferma con un
 * messaggio esplicito. L'apertura e' gia' stata scritta una volta e si modifica dalla pagina
 * /wallets (`PUT /wallet/:id`, `opening_balance_cents`): non ricalcolarla da `balance`.
 *
 * Uso, dalla root del repo server:
 *     node backfill-opening-balance.mjs            # dry-run: mostra cosa scriverebbe
 *     node backfill-opening-balance.mjs --apply    # scrive e verifica l'invariante
 *
 * Invariante verificata dopo la scrittura: `Wallet.balance == (opening_balance_cents + movimenti) / 100`.
 */

import { supabase } from "./config/supabaseClient.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

const apply = process.argv.includes("--apply");
const toCents = (amount) => Math.round(Math.abs(Number(amount)) * 100);
const toEur = (cents) => (cents / 100).toFixed(2);
const eur = (value) => Number(value).toFixed(2).padStart(12);

/** Somma entrate/spese per wallet in centesimi, paginando oltre il tetto di 1000 righe di PostgREST. */
const sumMovementsInCents = async () => {
  const balances = new Map();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("Transaction")
      .select("wallet_id, amount, type")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    for (const transaction of rows) {
      const key = String(transaction.wallet_id);
      const delta =
        transaction.type === "I"
          ? toCents(transaction.amount)
          : -toCents(transaction.amount);
      balances.set(key, (balances.get(key) ?? 0) + delta);
    }

    if (rows.length < PAGE_SIZE) return balances;
  }

  throw new Error(
    `Impossibile calcolare le aperture: superate ${MAX_PAGES} pagine di transazioni`
  );
};

const { data: wallets, error: walletError } = await supabase
  .from("Wallet")
  .select("id, userid, name, balance, opening_balance_cents");

if (walletError) {
  if (/opening_balance_cents/.test(walletError.message)) {
    console.error(
      "Colonna Wallet.opening_balance_cents assente: esegui prima migrations/003_wallet_opening_balance.sql"
    );
    process.exit(1);
  }
  if (/balance/.test(walletError.message)) {
    console.error(
      "Colonna Wallet.balance assente: rimossa da migrations/005_drop_wallet_balance.sql.\n" +
        "Questo backfill e' una migrazione una-tantum, gia' applicata: ricalcolerebbe l'apertura\n" +
        "da un valore che non esiste piu'. L'apertura vive in Wallet.opening_balance_cents e va\n" +
        "modificata dalla pagina /wallets, non ricalcolata da `balance`."
    );
    process.exit(1);
  }
  throw new Error(walletError.message);
}

const movements = await sumMovementsInCents();

const plan = (wallets ?? []).map((wallet) => {
  const movementsCents = movements.get(String(wallet.id)) ?? 0;
  const notComputable = wallet.balance === null || wallet.balance === undefined;
  const storedCents = notComputable ? 0 : Math.round(Number(wallet.balance) * 100);
  const openingCents = notComputable ? -movementsCents : storedCents - movementsCents;

  return {
    id: wallet.id,
    userid: wallet.userid,
    name: String(wallet.name ?? "").slice(0, 24).padEnd(26),
    storedCents,
    movementsCents,
    openingCents,
    currentOpeningCents: Number(wallet.opening_balance_cents ?? 0),
    notComputable,
    needsWrite: Number(wallet.opening_balance_cents ?? 0) !== openingCents,
  };
});

console.log(
  `Wallet: ${plan.length} | transazioni sommate: ${[...movements.values()].length} wallet con movimenti`
);
console.log(
  "  nome                       stored      movimenti      apertura     nuovo saldo   stato"
);

const toWrite = plan.filter((row) => row.needsWrite);

for (const row of plan) {
  const derivedCents = row.openingCents + row.movementsCents;
  console.log(
    " ",
    row.name,
    eur(toEur(row.storedCents)),
    eur(toEur(row.movementsCents)),
    eur(toEur(row.openingCents)),
    eur(toEur(derivedCents)),
    row.notComputable
      ? "NON CALCOLABILE (opening 0.00 di fallback, da correggere)"
      : row.needsWrite
        ? "da scrivere"
        : "gia' allineato"
  );
}

if (!apply) {
  console.log(
    `\nDRY-RUN: ${toWrite.length} wallet da toccare su ${plan.length}. Rilancia con --apply per scrivere.`
  );
  process.exit(0);
}

let touched = 0;
for (const row of toWrite) {
  const { error } = await supabase
    .from("Wallet")
    .update({ opening_balance_cents: row.openingCents })
    .eq("id", row.id)
    .eq("userid", row.userid);

  if (error) throw new Error(`wallet ${row.id}: ${error.message}`);
  touched += 1;
  console.log(
    `  scritto wallet ${row.id} (${row.name.trim()}): opening_balance_cents = ${row.openingCents} (${toEur(row.openingCents)} EUR)`
  );
}

// Rilettura: l'invariante va verificata sul DB, non sul piano.
const { data: after, error: afterError } = await supabase
  .from("Wallet")
  .select("id, name, balance, opening_balance_cents");

if (afterError) throw new Error(afterError.message);

let violations = 0;
for (const wallet of after ?? []) {
  const movementsCents = movements.get(String(wallet.id)) ?? 0;
  const derivedCents = Number(wallet.opening_balance_cents ?? 0) + movementsCents;
  const storedCents = Math.round(Number(wallet.balance ?? 0) * 100);
  if (derivedCents !== storedCents) {
    violations += 1;
    console.error(
      `  INVARIANTE VIOLATA wallet ${wallet.id}: stored ${toEur(storedCents)} != opening+movimenti ${toEur(derivedCents)}`
    );
  }
}

console.log(
  `\nWallet toccati: ${touched} su ${plan.length}. Invariante (stored == opening + movimenti): ${
    violations === 0 ? `OK su ${after?.length ?? 0} wallet` : `${violations} violazioni`
  }.`
);
process.exit(violations === 0 ? 0 : 1);
