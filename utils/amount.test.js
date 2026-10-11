import test from "node:test";
import assert from "node:assert/strict";

import { amountToCents, signedAmountCents } from "./amount.js";

test("amountToCents legge la magnitudine e ignora il segno del numero", () => {
  assert.equal(amountToCents(50), 5000);
  assert.equal(amountToCents(-50), 5000);
  assert.equal(amountToCents(12.34), 1234);
  // Righe non normalizzate da un import CSV: il segno è nel valore, non in `type`.
  assert.equal(amountToCents("-50.00"), 5000);
});

test("amountToCents non propaga NaN e somma i centesimi esatti", () => {
  assert.equal(amountToCents("abc"), 0);
  assert.equal(amountToCents(null), 0);
  assert.equal(amountToCents(undefined), 0);
  assert.equal(amountToCents(NaN), 0);
  // 0.1 + 0.2 === 0.30000000000000004: in float la somma sbaglierebbe di 1e-17.
  assert.equal(amountToCents(0.1 + 0.2), 30);
});

test("signedAmountCents prende il segno da type, non dal valore", () => {
  assert.equal(signedAmountCents(50, "I"), 5000);
  assert.equal(signedAmountCents(50, "E"), -5000);
  // Stesso valore, tipo diverso: segno diverso. Il numero non conta.
  assert.equal(signedAmountCents(-50, "I"), 5000);
  assert.equal(signedAmountCents(-50, "E"), -5000);
});

/**
 * Il criterio di accettazione: gli stessi dati letti con la regola di
 * `utils/amount.js` devono dare saldo e totali di periodo coerenti anche con
 * righe non normalizzate (importo negativo). I totali qui sono calcolati come
 * fanno i widget di dashboard (`lib/amount.ts` nel repo client: magnitudine per
 * tipo), il saldo come fa `sumBalancesInCents`.
 */
test("saldo e totali per tipo concordano su un set misto, righe negative incluse", () => {
  const transactions = [
    { amount: 2250, type: "I" },
    { amount: -76.4, type: "E" }, // non normalizzata: il segno è nel numero
    { amount: "-50.00", type: "E" },
    { amount: 25, type: "I" },
    { amount: 0.1 + 0.2, type: "E" },
  ];

  const balance = transactions.reduce(
    (total, tx) => total + signedAmountCents(tx.amount, tx.type),
    0
  );

  const incomes = transactions
    .filter((tx) => tx.type === "I")
    .reduce((total, tx) => total + amountToCents(tx.amount), 0);
  const expenses = transactions
    .filter((tx) => tx.type === "E")
    .reduce((total, tx) => total + amountToCents(tx.amount), 0);

  assert.equal(incomes, 227500); // 2250.00 + 25.00
  assert.equal(expenses, 12670); // 76.40 + 50.00 + 0.30
  assert.equal(balance, 214830);
  // L'identità che tiene insieme saldo e widget: il saldo è la differenza dei
  // due totali di periodo, non la somma dei valori grezzi.
  assert.equal(balance, incomes - expenses);
});
