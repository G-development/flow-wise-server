import { supabase } from "../config/supabaseClient.js";
import { signedAmountCents } from "./amount.js";

/**
 * Il saldo di un wallet non è memorizzato: è derivato dalle transazioni.
 *
 * Motivo: la colonna `Wallet.balance` andrebbe tenuta allineata da ogni percorso
 * che scrive su `Transaction` (transazioni, import CSV, import bancario) e basta
 * dimenticarne uno per avere un saldo sbagliato che sembra corretto. Derivarlo
 * rende `Transaction` l'unica fonte di verità.
 *
 * Tre dettagli non ovvi, tutti verificati sul progetto Supabase reale:
 *
 * 1. La somma parte da `Wallet.opening_balance_cents` (integer, centesimi,
 *    NOT NULL default 0), non da zero. Senza quel punto di partenza la somma è
 *    corretta solo se ogni movimento dalla nascita del wallet è in `Transaction`:
 *    con uno storico importato i movimenti precedenti all'import non ci sono e il
 *    saldo scende sotto zero (misurato: GC Default wallet derivava -13264.23 a
 *    fronte di un saldo reale di 0.00). L'apertura è quindi un argomento
 *    obbligato della somma, non un fallback silenzioso: se un wallet non la porta,
 *    la funzione fallisce invece di tornare a sommare da zero.
 * 2. PostgREST applica un tetto di righe per richiesta (1000 per default), quindi
 *    una singola select su `Transaction` troncherebbe la somma senza errori. Le
 *    transazioni vengono quindi lette a pagine con `.range()`.
 * 3. Gli aggregati lato database (`select=amount.sum()`) sono disabilitati su
 *    questo progetto (`PGRST123: Use of aggregate functions is not allowed`), per
 *    cui l'aggregazione avviene qui. Quando il volume crescerà, la sostituzione
 *    naturale è una view Postgres `wallet_balances` (GROUP BY wallet_id) letta in
 *    una sola query.
 *
 * Gli importi sono sommati in centesimi per evitare errori di virgola mobile.
 *
 * Il segno di ogni movimento non viene mai letto dal valore numerico: la regola
 * (`amount` assoluto, `type` decide il segno) sta in `utils/amount.js`, così il
 * saldo e i totali di periodo dei widget di dashboard restano d'accordo.
 */

const PAGE_SIZE = 1000;

// Limite di sicurezza: oltre questo numero di pagine qualcosa non torna e
// preferiamo un errore visibile a una somma parziale silenziosa.
const MAX_PAGES = 100;

const fromCents = (cents) => Number((cents / 100).toFixed(2));

/**
 * Punto di partenza della somma: il saldo di apertura di ogni wallet, in centesimi.
 *
 * È una Map e non un semplice `0` iniziale perché l'apertura è per wallet: ognuno
 * ha la sua. Il segno è ammesso (un'apertura negativa è un debito), quindi qui non
 * si applica `Math.abs` come per gli importi delle transazioni.
 *
 * @param {Array<{id: number|string, opening_balance_cents: number}>} wallets
 * @returns {Map<string, number>}
 * @throws {Error} se un wallet non porta un `opening_balance_cents` intero: la
 *   colonna è NOT NULL dalla migrazione `003_wallet_opening_balance.sql`, quindi la
 *   sua assenza significa schema non migrato o colonne scelte a mano dal chiamante.
 */
const openingBalancesInCents = (wallets) => {
  const balances = new Map();

  for (const wallet of wallets) {
    const opening = wallet?.opening_balance_cents;

    if (!Number.isInteger(opening)) {
      throw new Error(
        `Wallet ${wallet?.id}: opening_balance_cents mancante o non intero ` +
          `(ricevuto: ${JSON.stringify(opening)}). Esegui ` +
          "migrations/003_wallet_opening_balance.sql e passa i wallet completi a sumBalancesInCents."
      );
    }

    balances.set(String(wallet.id), opening);
  }

  return balances;
};

/**
 * Somma entrate e spese per wallet, **a partire dal saldo di apertura**.
 *
 * Per ogni wallet passato vale
 * `risultato.get(id) === wallet.opening_balance_cents + somma_movimenti_in_centesimi`:
 * il risultato non è mai la sola somma dei movimenti.
 *
 * Le transazioni il cui `wallet_id` non è tra i `wallets` passati (anomalia: wallet
 * cancellato con movimenti rimasti) finiscono in una voce della Map con i soli
 * movimenti: `getWalletsWithBalances` mappa sui wallet, quindi non le restituisce.
 *
 * @param {string} userId
 * @param {Array<{id: number|string, opening_balance_cents: number}>} wallets
 *   I wallet dell'utente con il saldo di apertura: `getWalletsWithBalances` li legge
 *   con `select("*")`. Obbligatorio — è il punto di partenza della somma.
 * @param {{client?: object}} [options] `client` è un seam di test (default: il client
 *   Supabase reale). In produzione non va passato.
 * @returns {Promise<Map<string, number>>} saldo in centesimi per wallet id
 * @throws {TypeError|Error} argomenti non validi, apertura mancante o errore PostgREST.
 */
export const sumBalancesInCents = async (
  userId,
  wallets,
  { client = supabase } = {}
) => {
  if (!Array.isArray(wallets)) {
    throw new TypeError(
      "sumBalancesInCents: wallets deve essere l'array dei wallet dell'utente, saldo di apertura incluso"
    );
  }

  const balances = openingBalancesInCents(wallets);

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await client
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
      const delta = signedAmountCents(transaction.amount, transaction.type);
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
 * Restituisce i wallet dell'utente con `balance` calcolato dalle transazioni, a
 * partire da `opening_balance_cents`.
 *
 * I wallet si leggono una volta sola e si passano alla somma: l'apertura che
 * inizializza `sumBalancesInCents` è esattamente lo stesso valore che la risposta
 * restituisce come `opening_balance_cents`. Nessun wallet resta fuori: la Map
 * contiene una voce per ognuno di quelli letti.
 *
 * @param {string} userId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export const getWalletsWithBalances = async (userId) => {
  const { data, error } = await supabase
    .from("Wallet")
    .select("*")
    .eq("userid", userId);

  if (error) {
    throw new Error(error.message);
  }

  const wallets = data ?? [];
  const balancesInCents = await sumBalancesInCents(userId, wallets);

  return wallets.map((wallet) => ({
    ...wallet,
    balance: fromCents(balancesInCents.get(String(wallet.id))),
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
