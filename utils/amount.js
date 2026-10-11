/**
 * Convenzione sugli importi di `Transaction`.
 *
 * `amount` è **sempre un valore assoluto** (>= 0) e `type` ("I" | "E") è
 * l'**unica** fonte del segno. Il segno non va mai letto dal numero: un
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
 * @param {unknown} amount
 * @param {string} type
 * @returns {number} centesimi firmati
 */
export const signedAmountCents = (amount, type) =>
  type === "I" ? amountToCents(amount) : -amountToCents(amount);
