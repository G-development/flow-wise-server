import test from "node:test";
import assert from "node:assert/strict";

import { amountToCents, signedAmountCents, walletDeltasCents } from "./amount.js";

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

test("signedAmountCents rifiuta ogni tipo che non sia I o E (T compreso)", () => {
  // Prima della migrazione 011 tutto cio' che non era "I" diventava una spesa: una
  // "T" avrebbe scalato l'origine senza accreditare la destinazione.
  assert.throws(() => signedAmountCents(50, "T"), /non è un'entrata né una spesa/);
  assert.throws(() => signedAmountCents(50, undefined), /non è un'entrata né una spesa/);
  assert.throws(() => signedAmountCents(50, "e"), /non è un'entrata né una spesa/);
});

test("walletDeltasCents: entrate e spese toccano solo wallet_id", () => {
  assert.deepEqual(walletDeltasCents({ amount: 50, type: "I", wallet_id: 1 }), [["1", 5000]]);
  assert.deepEqual(walletDeltasCents({ amount: -50, type: "E", wallet_id: 1 }), [["1", -5000]]);
});

test("walletDeltasCents: un trasferimento toglie dall'origine e aggiunge alla destinazione", () => {
  assert.deepEqual(
    walletDeltasCents({ amount: 150, type: "T", wallet_id: 1, to_wallet_id: 11 }),
    [["1", -15000], ["11", 15000]]
  );
});

test("walletDeltasCents: un lato da assegnare non tocca nessun saldo", () => {
  // "Accantonamento somma sul Salvadanaio": conto noto, salvadanaio da scegliere.
  assert.deepEqual(
    walletDeltasCents({ amount: 100, type: "T", wallet_id: 1, to_wallet_id: null }),
    [["1", -10000]]
  );
  // "Riunione somme dal salvadanaio": salvadanaio da scegliere, conto noto.
  assert.deepEqual(
    walletDeltasCents({ amount: 100, type: "T", wallet_id: null, to_wallet_id: 1 }),
    [["1", 10000]]
  );
});

test("walletDeltasCents rifiuta un tipo sconosciuto", () => {
  assert.throws(() => walletDeltasCents({ amount: 1, type: "X", wallet_id: 1 }), /non è un'entrata né una spesa/);
});
