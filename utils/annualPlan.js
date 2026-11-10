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
 * Il piano di un salvadanaio.
 *
 * - `shortfallNowCents`: quanto manca oggi per le rate del mese corrente (e quelle in ritardo).
 *   Nessuna quota lo risolve: i versamenti di questo mese contano dal mese prossimo.
 * - `suggestedMonthlyCents`: la quota mensile piu' bassa che copre ogni scadenza dei prossimi
 *   12 mesi = max su k di (rate fino al mese k − saldo) / k, arrotondata al centesimo per eccesso,
 *   mai sotto zero.
 * - Tetto (`capCents`, fisso o dal piano): la quota non porta il saldo sopra il tetto in nessun
 *   mese. Se coprire le scadenze richiede di superarlo, vince la copertura e `capConflict` lo dice.
 * - `projection`: saldo previsto a fine di ogni mese 0…12 versando la quota consigliata.
 *
 * @param {{balanceCents: number, installments: Array<{due_date: string, amount_cents: number, paid?: boolean}>,
 *          today: string, capCents?: number|null, capFromPlan?: boolean}} input
 */
export const computeAnnualPlan = ({ balanceCents, installments, today, capCents = null, capFromPlan = false }) => {
  const dues = duesByMonth(installments, today);
  const cumulative = [];
  dues.reduce((sum, value, index) => (cumulative[index] = sum + value), 0);

  const shortfallNowCents = Math.max(0, cumulative[0] - balanceCents);

  let needed = 0;
  for (let k = 1; k <= PLAN_MONTHS; k += 1) {
    needed = Math.max(needed, Math.ceil((cumulative[k] - balanceCents) / k));
  }
  needed = Math.max(0, needed);

  const effectiveCapCents = capFromPlan ? planCapCents(installments, today) : capCents;
  let suggested = needed;
  let capConflict = false;
  if (effectiveCapCents != null) {
    // Quota massima che non supera il tetto in nessun mese: saldo + k·q − rate fino a k ≤ tetto.
    let maxUnderCap = Infinity;
    for (let k = 1; k <= PLAN_MONTHS; k += 1) {
      maxUnderCap = Math.min(maxUnderCap, Math.floor((effectiveCapCents + cumulative[k] - balanceCents) / k));
    }
    maxUnderCap = Math.max(0, maxUnderCap);
    if (maxUnderCap < needed) capConflict = true;
    else suggested = Math.min(needed, maxUnderCap);
  }

  const projection = cumulative.map((due, k) => ({
    month: k,
    dueCents: dues[k],
    balanceCents: balanceCents + k * suggested - due,
  }));

  return {
    balanceCents,
    shortfallNowCents,
    suggestedMonthlyCents: suggested,
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
