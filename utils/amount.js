/**
 * Convenzione sugli importi di `Transaction`.
 *
 * `amount` è **sempre un valore assoluto** (>= 0) e `type` ("I" | "E" | "T") è
 * l'**unica** fonte del segno. Per un trasferimento `"T"` il segno dipende dal
 * lato: − sull'origine `wallet_id`, + sulla destinazione `to_wallet_id`. Il segno non va mai letto dal numero: un
 * `amount` negativo non significa "uscita", significa "dato non normalizzato"
 * (un import CSV o bancario con `-50,00` scritto cosi com'è).
 *
 * Perché serve un punto solo: il saldo di `utils/walletService.js` e i totali
 * di periodo dei widget di dashboard leggono gli stessi dati. Se ognuno
 * interpreta il segno a modo suo, bastano due righe con segno diverso perché
 * saldo e totali si contraddicano **senza** che nessuna delle due parti segnali
 * niente. Qui la regola è una sola e si applica in un punto solo.
 *
 * Lato client la stessa regola vive in `flow-wise-client/lib/amount.ts`. Sono
 * due file e non uno condiviso perché i due repo sono separati: se la
 * convenzione cambia, vanno cambiati entrambi.
 *
 * Gli importi sono trattati in centesimi per evitare errori di virgola mobile.
 *
 * Nota: vale per `Transaction`. In `bank_transactions` il segno **è** nel
 * valore, perché è il formato che arriva dal provider bancario: la traduzione
 * avviene all'import (`positiveAmount` + `type`), non qui.
 */

/**
 * Magnitudine in centesimi letta da `amount`: il segno, se c'è, è ignorato.
 * Input non numerici valgono 0 (nessun NaN propagato nelle somme).
 *
 * @param {unknown} amount
 * @returns {number} centesimi, sempre >= 0
 */
export const amountToCents = (amount) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.abs(value) * 100);
};

/**
 * Valore firmato in centesimi: `type: "I"` positivo, `"E"` negativo.
 *
 * Vale solo per entrate e spese. Un trasferimento (`"T"`) non ha un segno unico:
 * toglie da un wallet e aggiunge a un altro, quindi va letto con
 * `walletDeltasCents`. Qualsiasi altro tipo è un errore: prima della migrazione
 * 011 tutto ciò che non era `"I"` diventava una spesa, e una `"T"` avrebbe
 * scalato l'origine senza accreditare la destinazione, senza alcun segnale.
 *
 * @param {unknown} amount
 * @param {string} type
 * @returns {number} centesimi firmati
 * @throws {Error} se `type` non è `"I"` né `"E"`
 */
export const signedAmountCents = (amount, type) => {
  if (type === "I") return amountToCents(amount);
  if (type === "E") return -amountToCents(amount);
  throw new Error(`signedAmountCents: type ${JSON.stringify(type)} is neither an income nor an expense`);
};

/**
 * Effetto di una transazione sui saldi: coppie `[walletId, centesimi firmati]`.
 *
 * - `"I"`: + su `wallet_id`
 * - `"E"`: − su `wallet_id`
 * - `"T"`: − su `wallet_id` (origine) e + su `to_wallet_id` (destinazione). Un lato
 *   vuoto è un trasferimento "da assegnare" (migrazione 011) e non tocca nessun saldo.
 *
 * @param {{amount: unknown, type: string, wallet_id?: unknown, to_wallet_id?: unknown}} transaction
 * @returns {Array<[string, number]>}
 * @throws {Error} se `type` non è `"I"`, `"E"` né `"T"`
 */
export const walletDeltasCents = ({ amount, type, wallet_id, to_wallet_id }) => {
  if (type !== "T") return [[String(wallet_id), signedAmountCents(amount, type)]];

  const cents = amountToCents(amount);
  const deltas = [];
  if (wallet_id != null) deltas.push([String(wallet_id), -cents]);
  if (to_wallet_id != null) deltas.push([String(to_wallet_id), cents]);
  return deltas;
};
