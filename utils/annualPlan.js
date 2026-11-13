/**
 * Calcolo del piano delle spese annuali (fase 3, TODO_SALVADANAI.md). Funzioni pure: nessun
 * accesso al database, cosi' le regole si provano con casi scritti a mano.
 *
 * Mesi: 0 = mese corrente, 1…12 = i successivi. Regola dei tempi (decisa per tutti gli utenti):
 * **i versamenti di un mese coprono le rate dei mesi successivi**; le rate del mese corrente le
 * copre il saldo che il salvadanaio ha gia'. Quindi per una rata nel mese k ci sono k versamenti
 * utili (quelli dei mesi 0…k−1).
 *
 * Tutti gli importi sono in centesimi interi.
 */

export const PLAN_MONTHS = 12;

/** Indice del mese di `date` rispetto a `today` (0 = stesso mese, negativo = passato). */
export const monthIndex = (date, today) => {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const t = new Date(`${String(today).slice(0, 10)}T00:00:00Z`);
  return (d.getUTCFullYear() - t.getUTCFullYear()) * 12 + (d.getUTCMonth() - t.getUTCMonth());
};

/**
 * Rate da pagare per mese, 0…12. Una rata gia' pagata non conta (i soldi sono gia' usciti dal
 * salvadanaio). Una rata passata e non pagata e' **in ritardo**: conta nel mese 0, perche' va
 * coperta adesso. Le rate oltre i 12 mesi restano fuori.
 */
export const duesByMonth = (installments, today) => {
  const dues = new Array(PLAN_MONTHS + 1).fill(0);
  for (const installment of installments) {
    if (installment.paid) continue;
    const index = Math.max(0, monthIndex(installment.due_date, today));
    if (index <= PLAN_MONTHS) dues[index] += installment.amount_cents;
  }
  return dues;
};

/** Tetto calcolato dal piano: tutte le rate dei mesi 1…12, pagate o no (e' la spesa dell'anno a venire). */
export const planCapCents = (installments, today) =>
  installments.reduce((sum, installment) => {
    const index = monthIndex(installment.due_date, today);
    return index >= 1 && index <= PLAN_MONTHS ? sum + installment.amount_cents : sum;
  }, 0);

/**
 * Rate dei 12 mesi dopo l'orizzonte (mesi 13…24), per non far crollare i versamenti verso fine
 * anno: le spese annuali si ripetono. Il mese 12+j vale il **massimo** fra le rate gia' inserite in
 * quel mese (es. dopo "Copia sull'anno dopo") e quelle del mese j dell'anno in corso, pagate o no
 * (stessa regola di `planCapCents`). Il massimo, non la somma: una voce gia' copiata non conta due volte.
 */
export const nextYearDues = (installments, today) => {
  const planned = new Array(PLAN_MONTHS + 1).fill(0);
  const actual = new Array(PLAN_MONTHS + 1).fill(0);
  for (const installment of installments) {
    const index = monthIndex(installment.due_date, today);
    if (index >= 1 && index <= PLAN_MONTHS) planned[index] += installment.amount_cents;
    if (!installment.paid && index > PLAN_MONTHS && index <= 2 * PLAN_MONTHS) actual[index - PLAN_MONTHS] += installment.amount_cents;
  }
  return planned.map((value, j) => (j === 0 ? 0 : Math.max(value, actual[j]))).slice(1);
};

/**
 * Versamenti consigliati mese per mese (13/11/2026, richiesta di Gio): ogni mese m il versamento
 * piu' basso che, ripetuto, copre tutte le scadenze dei 12 mesi successivi partendo dal saldo
 * previsto in quel momento. Se il salvadanaio e' indietro i primi versamenti sono alti, poi scendono
 * verso la media annua. Si ricalcola a ogni richiesta, quindi un pagamento o una rata nuova lo
 * aggiornano da soli.
 *
 * @param {number} startCents saldo a fine mese 0, dopo le rate del mese 0
 * @param {number[]} dues rate per mese, 0…24
 * @returns {number[]} versamento del mese m, m = 0…12 (arriva prima delle rate del mese m+1)
 */
export const depositSchedule = (startCents, dues) => {
  const deposits = [];
  let balance = startCents;
  for (let m = 0; m <= PLAN_MONTHS; m += 1) {
    let need = 0;
    let cumulative = 0;
    for (let k = m + 1; k <= Math.min(m + PLAN_MONTHS, dues.length - 1); k += 1) {
      cumulative += dues[k];
      need = Math.max(need, Math.ceil((cumulative - balance) / (k - m)));
    }
    const deposit = Math.max(0, need);
    deposits.push(deposit);
    balance += deposit - (dues[m + 1] ?? 0);
  }
  return deposits;
};

/**
 * Il piano di un salvadanaio.
 *
 * - `shortfallNowCents`: quanto manca oggi per le rate del mese corrente (e quelle in ritardo).
 *   Nessun versamento lo risolve: i versamenti di questo mese contano dal mese prossimo.
 * - `projection`: per ogni mese 0…12 le rate (`dueCents`), il versamento consigliato di quel mese
 *   (`depositCents`, vedi `depositSchedule`) e il saldo a fine mese (`balanceCents`) seguendo il piano.
 * - `suggestedMonthlyCents`: il versamento di **questo** mese (= `projection[0].depositCents`): la
 *   quota piu' bassa che copre ogni scadenza dei prossimi 12 mesi, come prima del 13/11.
 * - Tetto (`capCents`, fisso o dal piano): i versamenti sono gia' i minimi possibili; se seguendoli il
 *   saldo supera il tetto in qualche mese, coprire le scadenze lo richiede e `capConflict` lo dice.
 *
 * @param {{balanceCents: number, installments: Array<{due_date: string, amount_cents: number, paid?: boolean}>,
 *          today: string, capCents?: number|null, capFromPlan?: boolean}} input
 */
export const computeAnnualPlan = ({ balanceCents, installments, today, capCents = null, capFromPlan = false }) => {
  const dues = duesByMonth(installments, today);
  const allDues = [...dues, ...nextYearDues(installments, today)];
  const shortfallNowCents = Math.max(0, dues[0] - balanceCents);

  const deposits = depositSchedule(balanceCents - dues[0], allDues);
  const projection = [];
  let balance = balanceCents - dues[0];
  for (let k = 0; k <= PLAN_MONTHS; k += 1) {
    if (k > 0) balance += deposits[k - 1] - dues[k];
    projection.push({ month: k, dueCents: dues[k], depositCents: deposits[k], balanceCents: balance });
  }

  const effectiveCapCents = capFromPlan ? planCapCents(installments, today) : capCents;
  const capConflict =
    effectiveCapCents != null && projection.some((row) => row.balanceCents > effectiveCapCents);

  return {
    balanceCents,
    shortfallNowCents,
    suggestedMonthlyCents: deposits[0],
    capCents: effectiveCapCents,
    capConflict,
    projection,
    negativeMonths: projection.filter((row) => row.balanceCents < 0).map((row) => row.month),
  };
};

/** Le date di `installments` spostate di un anno (per "copia sull'anno successivo"). */
export const shiftOneYear = (date) => {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  // 29 febbraio -> 28 febbraio dell'anno dopo se non bisestile.
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return `${year + 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
};
