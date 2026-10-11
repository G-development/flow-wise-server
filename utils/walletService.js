import { supabase } from "../config/supabaseClient.js";

/**
 * Il saldo di un wallet non è memorizzato: è derivato dalle transazioni.
 *
 * Motivo: la colonna `Wallet.balance` andrebbe tenuta allineata da ogni percorso
 * che scrive su `Transaction` (transazioni, import CSV, import bancario) e basta
 * dimenticarne uno per avere un saldo sbagliato che sembra corretto. Derivarlo
 * rende `Transaction` l'unica fonte di verità.
 *
 * Due dettagli non ovvi, entrambi verificati sul progetto Supabase reale:
 *
 * 1. PostgREST applica un tetto di righe per richiesta (1000 per default), quindi
 *    una singola select su `Transaction` troncherebbe la somma senza errori. Le
 *    transazioni vengono quindi lette a pagine con `.range()`.
 * 2. Gli aggregati lato database (`select=amount.sum()`) sono disabilitati su
 *    questo progetto (`PGRST123: Use of aggregate functions is not allowed`), per
 *    cui l'aggregazione avviene qui. Quando il volume crescerà, la sostituzione
 *    naturale è una view Postgres `wallet_balances` (GROUP BY wallet_id) letta in
 *    una sola query.
 *
 * Gli importi sono sommati in centesimi per evitare errori di virgola mobile.
 */

const PAGE_SIZE = 1000;

// Limite di sicurezza: oltre questo numero di pagine qualcosa non torna e
// preferiamo un errore visibile a una somma parziale silenziosa.
const MAX_PAGES = 100;

const toCents = (amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  // Il tipo I/E determina il segno: l'importo memorizzato è positivo.
  return Math.round(Math.abs(value) * 100);
};

const fromCents = (cents) => Number((cents / 100).toFixed(2));

/**
 * Somma entrate e spese per wallet, leggendo tutte le pagine di transazioni.
 *
 * @param {string} userId
 * @returns {Promise<Map<string, number>>} saldo in centesimi per wallet id
 */
const sumBalancesInCents = async (userId) => {
  const balances = new Map();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("Transaction")
      .select("wallet_id, amount, type")
      .eq("userid", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = data ?? [];
    for (const transaction of rows) {
      const key = String(transaction.wallet_id);
      const delta =
        transaction.type === "I"
          ? toCents(transaction.amount)
          : -toCents(transaction.amount);
      balances.set(key, (balances.get(key) ?? 0) + delta);
    }

    if (rows.length < PAGE_SIZE) {
      return balances;
    }
  }

  throw new Error(
    `Impossibile calcolare il saldo: superate ${MAX_PAGES} pagine di transazioni`
  );
};

/**
 * Restituisce i wallet dell'utente con `balance` calcolato dalle transazioni.
 *
 * @param {string} userId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export const getWalletsWithBalances = async (userId) => {
  const [walletResult, balancesInCents] = await Promise.all([
    supabase.from("Wallet").select("*").eq("userid", userId),
    sumBalancesInCents(userId),
  ]);

  if (walletResult.error) {
    throw new Error(walletResult.error.message);
  }

  return (walletResult.data ?? []).map((wallet) => ({
    ...wallet,
    balance: fromCents(balancesInCents.get(String(wallet.id)) ?? 0),
  }));
};

/**
 * Saldo di un singolo wallet dell'utente, o null se non gli appartiene.
 */
export const getWalletBalance = async (userId, walletId) => {
  const wallets = await getWalletsWithBalances(userId);
  const wallet = wallets.find((item) => String(item.id) === String(walletId));
  return wallet
    ? { id: wallet.id, name: wallet.name, balance: wallet.balance }
    : null;
};
