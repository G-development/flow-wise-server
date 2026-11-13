import test from "node:test";
import assert from "node:assert/strict";

import { computeAnnualPlan, depositSchedule, duesByMonth, monthIndex, nextYearDues, planCapCents, shiftOneYear } from "./annualPlan.js";

const TODAY = "2026-11-10";
const rata = (due_date, euro, paid = false) => ({ due_date, amount_cents: Math.round(euro * 100), paid });

test("monthIndex: 0 il mese corrente, positivo i successivi, negativo il passato", () => {
  assert.equal(monthIndex("2026-11-30", TODAY), 0);
  assert.equal(monthIndex("2026-12-03", TODAY), 1);
  assert.equal(monthIndex("2027-11-01", TODAY), 12);
  assert.equal(monthIndex("2026-10-31", TODAY), -1);
});

test("duesByMonth: le pagate non contano, le passate non pagate vanno nel mese 0, oltre 12 mesi fuori", () => {
  const dues = duesByMonth(
    [rata("2026-12-03", 300), rata("2026-12-16", 200), rata("2026-10-05", 50), rata("2026-10-06", 70, true), rata("2028-01-01", 999)],
    TODAY
  );
  assert.equal(dues[0], 5000, "la rata di ottobre non pagata e' in ritardo: conta adesso");
  assert.equal(dues[1], 50000);
  assert.equal(dues.reduce((a, b) => a + b, 0), 55000);
});

test("quota: 200 € oggi, 500 a dicembre e 477 ad aprile chiedono 300 €/mese (un solo versamento utile per dicembre)", () => {
  // Dicembre e' il mese 1: un solo versamento utile (fine novembre). Con 200 € di saldo mancano
  // 300 € -> 300 €/mese. L'esempio del piano contava due versamenti; con la regola decisa il 10/11
  // (i versamenti coprono i mesi successivi) per dicembre ce n'e' uno solo.
  const plan = computeAnnualPlan({
    balanceCents: 20000,
    installments: [rata("2026-12-10", 500), rata("2027-04-10", 477)],
    today: TODAY,
  });
  assert.equal(plan.suggestedMonthlyCents, 30000);
  assert.equal(plan.shortfallNowCents, 0);
  assert.deepEqual(plan.negativeMonths, []);
  assert.equal(plan.projection[1].balanceCents, 20000 + 30000 - 50000, "a fine dicembre il fondo e' esattamente a 0");
});

test("quota: con scadenze lontane basta la media, arrotondata per eccesso al centesimo", () => {
  const plan = computeAnnualPlan({ balanceCents: 0, installments: [rata("2027-11-15", 100)], today: TODAY });
  // 100 € fra 12 mesi: 12 versamenti -> 8,34 € (8,333… per eccesso).
  assert.equal(plan.suggestedMonthlyCents, 834);
  assert.ok(plan.projection[12].balanceCents >= 0);
});

test("quota zero se il saldo copre gia' tutto", () => {
  const plan = computeAnnualPlan({ balanceCents: 100000, installments: [rata("2027-04-01", 477)], today: TODAY });
  assert.equal(plan.suggestedMonthlyCents, 0);
});

test("scoperto adesso: le rate del mese corrente superano il saldo, nessuna quota lo risolve", () => {
  const plan = computeAnnualPlan({ balanceCents: 6000, installments: [rata("2026-11-30", 127.5)], today: TODAY });
  assert.equal(plan.shortfallNowCents, 6750);
  assert.deepEqual(plan.negativeMonths.includes(0), true);
});

test("tetto fisso: la quota non porta il saldo sopra il tetto", () => {
  // Nessuna scadenza: la quota necessaria e' 0 e resta 0 (il tetto non crea versamenti).
  const idle = computeAnnualPlan({ balanceCents: 90000, installments: [], today: TODAY, capCents: 100000 });
  assert.equal(idle.suggestedMonthlyCents, 0);
  assert.equal(idle.capConflict, false);
});

test("tetto: se coprire le scadenze richiede di superarlo, vince la copertura e lo segnala", () => {
  const plan = computeAnnualPlan({
    balanceCents: 0,
    installments: [rata("2027-06-01", 2000)],
    today: TODAY,
    capCents: 50000,
  });
  // Servono 2000 € in 7 versamenti, ma il fondo arriverebbe sopra 500 € prima di giugno.
  assert.equal(plan.capConflict, true);
  assert.equal(plan.suggestedMonthlyCents, Math.ceil(200000 / 7));
});

test("tetto dal piano: somma delle rate dei prossimi 12 mesi, pagate o no, senza il mese corrente", () => {
  const installments = [rata("2026-11-20", 50), rata("2026-12-03", 300), rata("2027-04-01", 477, true), rata("2027-12-01", 99)];
  assert.equal(planCapCents(installments, TODAY), 30000 + 47700);
  const plan = computeAnnualPlan({ balanceCents: 0, installments, today: TODAY, capFromPlan: true });
  assert.equal(plan.capCents, 77700);
});

test("shiftOneYear sposta la data di un anno, 29 febbraio compreso", () => {
  assert.equal(shiftOneYear("2026-12-03"), "2027-12-03");
  assert.equal(shiftOneYear("2028-02-29"), "2029-02-28");
});

// --- Versamenti mese per mese (13/11/2026) -----------------------------------------------------

/** Le rate del salvadanaio Annuali di Gio al 13/11/2026 (dallo screenshot del piano). */
const annualiDiGio = () => [
  rata("2026-12-01", 580.37),
  rata("2027-01-01", 427.5),
  rata("2027-02-01", 380.37),
  rata("2027-03-01", 127.5),
  rata("2027-04-01", 697.36),
  rata("2027-05-01", 355.5),
  rata("2027-07-01", 127.5),
  rata("2027-09-01", 127.5),
  rata("2027-11-01", 127.5),
];

test("versamenti: partono alti per recuperare e scendono verso la media annua", () => {
  const plan = computeAnnualPlan({ balanceCents: 6000, installments: annualiDiGio(), today: "2026-11-13" });
  const deposits = plan.projection.map((row) => row.depositCents);
  assert.equal(deposits[0], 52037, "novembre: 580,37 a dicembre con 60 € nel salvadanaio");
  assert.equal(plan.suggestedMonthlyCents, deposits[0], "la quota in alto e' il versamento di questo mese");
  assert.equal(deposits[1], 42750);
  for (let m = 1; m < 6; m += 1) assert.ok(deposits[m] <= deposits[m - 1], `il versamento non risale al mese ${m}`);
  // da maggio la media annua: 2951,10 € / 12 = 245,925 -> 245,93
  for (const m of [6, 7, 8, 9, 10, 11]) assert.equal(deposits[m], 24593, `mese ${m}`);
  assert.deepEqual(plan.negativeMonths, [], "seguendo il piano nessun mese va sotto zero");
  assert.equal(plan.projection[1].balanceCents, 0, "a fine dicembre il fondo e' esattamente a 0");
});

test("versamenti: una rata pagata ricalcola il piano", () => {
  const before = computeAnnualPlan({ balanceCents: 6000, installments: annualiDiGio(), today: "2026-11-13" });
  const paidDecember = annualiDiGio().map((r, i) => (i === 0 ? { ...r, paid: true } : r));
  // pagata dal salvadanaio: il saldo scende, la rata non conta piu'
  const after = computeAnnualPlan({ balanceCents: 0, installments: paidDecember, today: "2026-11-13" });
  assert.ok(after.projection[0].depositCents < before.projection[0].depositCents);
  // senza dicembre: gennaio…maggio (1.988,23 €) con 6 versamenti utili -> 331,38 €
  assert.equal(after.projection[0].depositCents, 33138);
});

test("versamenti: l'anno dopo conta le rate ripetute, senza contare due volte quelle gia' copiate", () => {
  const year = [rata("2026-12-01", 120), rata("2027-06-01", 240)];
  const copied = [...year, rata("2027-12-01", 120), rata("2028-06-01", 240)];
  const repeated = nextYearDues(year, TODAY);
  assert.equal(repeated.length, 12);
  assert.equal(repeated[0], 12000, "dicembre 2027 = dicembre 2026");
  assert.deepEqual(nextYearDues(copied, TODAY), repeated, "copiate o ripetute, stessa somma");
});

test("depositSchedule: nessuna scadenza, nessun versamento; un buco va recuperato subito", () => {
  assert.deepEqual(depositSchedule(0, new Array(25).fill(0)), new Array(13).fill(0));
  const dues = new Array(25).fill(0);
  assert.equal(depositSchedule(-5000, dues)[0], 5000, "saldo sotto zero: il primo versamento lo riporta a zero");
});
