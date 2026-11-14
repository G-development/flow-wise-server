import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeWithRules,
  extractFreeText,
  extractMerchantKey,
  findMatchingRule,
  freeTextKey,
  isValidKeyword,
  learnRuleFromCorrection,
  normalizeForRules,
} from "./categoryRules.js";

// Descrizioni nei formati Intesa Sanpaolo visti nei dati reali, con nomi inventati.
const SAMPLES = [
  ["PAGAM. TRAMITE POS CONAD SUPERMERCATO VIA ALIM31/07-18:03 - Carta n.1234 XXXX XXXX XX00ABI : 09517", "conad supermercato"],
  ["PAGAM. TRAMITE POS Pagamento su POS MICROSOFT ROMA 26/10-11:16 - Carta n.1234 XXXX XXXX XX00", "microsoft"],
  ["PAGAMENTO POS EFFETTUATO IL 26/07/2026 ALLE ORE 19:45 MEDIANTE LA CARTA 1234 XXXX XXXX XX00 PRESSO DOPPIO MALTO BAR SAN S MILANO", "doppio malto"],
  ["Effettuato Il 21/02/2026 Alle Ore 1607 Mediante La Carta 1234 Xxxx Xxxx Xx00 Presso Atac Tap&go Roma (Atac Tap&go Roma)", "atac tap"],
  ["INVIO BANCOMAT PAY Verso MARIO ROSSI data: 23.07 IBAN Benef. IT00X0000000000000000000000", "verso mario rossi"],
  ["ACCR. BANCOMAT PAY Da MARIO ROSSI data: 22.07 identific.univoco transazione P2P0003", "da mario rossi"],
  ["ADDEBITO BON IST 0126082298144384 02INTER20260822 Bonifico da Voi disposto a favore di: Anna Bianchi Affitto", "verso anna bianchi"],
  ["ACCR BON ISTANT COD. DISP.: 0126 CASH Bonifico a Vostro favore disposto da: MITT.: Luca Verdi BENEF.: Mario Rossi BIC. ORD.: XXX", "da luca verdi"],
  ["COMM. CBILL/PAGOPA NOME AZIENDA AGENZIA DELLE ENTRATE - RISCOSSIONE CODICE AZIENDA AJZ8Z , IUV 801", "agenzia entrate"],
  ["COD. DISP. 0126010709875831 NOME UnipolTech MANDATO MND0000501050 (Addebito Diretto)", "unipoltech"],
  ["MOVIM. SALVADANAIO Accantonamento somma sul Salvadanaio", "salvadanaio"],
  ["MICROSOFT ROMA VIALE AVIGNO02/021045 Carta N.1234 XXXX XXXX XX00ABI 03069", "microsoft"],
];

test("extractMerchantKey riconosce il negozio o la controparte nei formati Intesa", () => {
  for (const [description, expected] of SAMPLES) {
    assert.equal(extractMerchantKey(description), expected, description);
  }
});

test("normalizeForRules: minuscole, niente accenti, cifre e punteggiatura", () => {
  assert.equal(normalizeForRules("Caffè DEI14/07  Più-Bello!"), "caffe dei piu bello");
  assert.equal(isValidKeyword("conad"), true);
  assert.equal(isValidKeyword("Conad"), false);
  assert.equal(isValidKeyword("ab"), false);
});

const rules = [
  { keyword: "mcdonald", type: "E", category_id: 10, updated_at: "2026-10-01" },
  { keyword: "mcdonald romanina", type: "E", category_id: 11, updated_at: "2026-09-01" },
  { keyword: "salvadanaio", type: "E", category_id: 20, updated_at: "2026-09-01" },
  { keyword: "salvadanaio", type: "I", category_id: 21, updated_at: "2026-09-01" },
];

test("findMatchingRule: parole intere, vince la parola chiave piu' lunga", () => {
  assert.equal(findMatchingRule("PAGAM. TRAMITE POS MCDONALD ROMANINA", "E", rules).category_id, 11);
  assert.equal(findMatchingRule("PAGAM. TRAMITE POS MCDONALD AUREA", "E", rules).category_id, 10);
  assert.equal(findMatchingRule("PAGAM. TRAMITE POS MCDONALDS", "E", rules), null);
});

test("findMatchingRule rispetta il tipo del movimento", () => {
  assert.equal(findMatchingRule("MOVIM. SALVADANAIO", "E", rules).category_id, 20);
  assert.equal(findMatchingRule("MOVIM. SALVADANAIO", "I", rules).category_id, 21);
});

test("categorizeWithRules scarta regole verso categorie disattivate o di un altro tipo", () => {
  const categories = [
    { id: 10, type: "E", active: true },
    { id: 11, type: "E", active: false },
    { id: 20, type: "I", active: true },
  ];
  const result = categorizeWithRules(
    [
      { ref: "0", type: "E", description: "POS MCDONALD AUREA", counterparty: "" },
      { ref: "1", type: "E", description: "POS MCDONALD ROMANINA", counterparty: "" },
      { ref: "2", type: "E", description: "MOVIM. SALVADANAIO", counterparty: "" },
      { ref: "3", type: "E", description: "BAR SCONOSCIUTO", counterparty: "" },
    ],
    { rules, categories }
  );
  assert.equal(result.get("0"), 10);
  assert.equal(result.get("1"), null); // categoria disattivata
  assert.equal(result.get("2"), null); // la categoria 20 e' di entrata
  assert.equal(result.get("3"), null); // nessuna regola
});

/** Client finto: risponde per tabella e registra gli upsert. */
const fakeClient = ({ category, bankTxn }) => {
  const upserts = [];
  const from = (table) => {
    const state = { table, op: "select", payload: null };
    const builder = {
      select() { return builder; },
      eq() { return builder; },
      upsert(payload, options) { state.op = "upsert"; state.payload = payload; state.options = options; return builder; },
      maybeSingle() { return builder; },
      single() { return builder; },
      then(resolve) {
        if (state.op === "upsert") {
          upserts.push(state);
          return Promise.resolve({ data: { ...state.payload }, error: null }).then(resolve);
        }
        const data = table === "Category" ? category : table === "bank_transactions" ? bankTxn : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  };
  return { client: { from }, upserts };
};

const bankTxn = { description: "PAGAM. TRAMITE POS CONAD SUPERMERCATO VIA ALIM31/07-18:03", counterparty: "" };
const corrected = { bank_transaction_id: "b1", category_id: 5, type: "E" };

test("learnRuleFromCorrection salva una regola 'learned' dal nome del negozio", async () => {
  const { client, upserts } = fakeClient({ category: { id: 5, name: "Spesa", type: "E" }, bankTxn });
  const rule = await learnRuleFromCorrection(client, { userId: "u1", previousCategoryId: 9, transaction: corrected });

  assert.equal(rule.keyword, "conad supermercato");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].payload.source, "learned");
  assert.equal(upserts[0].payload.category_id, 5);
  assert.deepEqual(upserts[0].options, { onConflict: "user_id,type,keyword" });
});

test("learnRuleFromCorrection non impara 'Altro', ne' una categoria invariata, ne' un movimento non bancario", async () => {
  const altro = fakeClient({ category: { id: 5, name: " Altro ", type: "E" }, bankTxn });
  assert.equal(await learnRuleFromCorrection(altro.client, { userId: "u1", previousCategoryId: 9, transaction: corrected }), null);
  assert.equal(altro.upserts.length, 0);

  const same = fakeClient({ category: { id: 5, name: "Spesa", type: "E" }, bankTxn });
  assert.equal(await learnRuleFromCorrection(same.client, { userId: "u1", previousCategoryId: 5, transaction: corrected }), null);

  const manual = fakeClient({ category: { id: 5, name: "Spesa", type: "E" }, bankTxn });
  assert.equal(
    await learnRuleFromCorrection(manual.client, { userId: "u1", previousCategoryId: 9, transaction: { ...corrected, bank_transaction_id: null } }),
    null
  );
  assert.equal(same.upserts.length + manual.upserts.length, 0);
});

test("categorizeWithRules: le chiavi con prefisso combaciano anche con i bonifici", () => {
  const personRules = [
    { keyword: "verso anna bianchi", type: "E", category_id: 40 },
    { keyword: "da luca verdi", type: "I", category_id: 41 },
  ];
  const categories = [
    { id: 40, type: "E", active: true },
    { id: 41, type: "I", active: true },
  ];
  const result = categorizeWithRules(
    [
      { ref: "0", type: "E", description: "ADDEBITO BON IST 0126 Bonifico da Voi disposto a favore di: Anna Bianchi Affitto", counterparty: "" },
      { ref: "1", type: "I", description: "ACCR BON ISTANT Bonifico a Vostro favore disposto da: MITT.: Luca Verdi BENEF.: Mario Rossi", counterparty: "" },
    ],
    { rules: personRules, categories }
  );
  assert.equal(result.get("0"), 40);
  assert.equal(result.get("1"), 41);
});

test("categorizeWithRules: una regola verso la categoria T vale per entrambi i segni", () => {
  const transferRules = [
    { keyword: "salvadanaio", type: "E", category_id: 54 },
    { keyword: "salvadanaio", type: "I", category_id: 54 },
  ];
  const categories = [{ id: 54, type: "T", active: true }];
  const result = categorizeWithRules(
    [
      { ref: "0", type: "E", description: "MOVIM. SALVADANAIO Accantonamento somma sul Salvadanaio", counterparty: "" },
      { ref: "1", type: "I", description: "MOVIM. SALVADANAIO Riunione somme dal salvadanaio", counterparty: "" },
    ],
    { rules: transferRules, categories }
  );
  assert.equal(result.get("0"), 54);
  assert.equal(result.get("1"), 54);
});

test("learnRuleFromCorrection: una correzione verso Trasferimento impara la categoria col tipo del segno", async () => {
  const salvadanaio = { description: "MOVIM. SALVADANAIO Accantonamento somma sul Salvadanaio", counterparty: "", amount: -100 };
  const { client, upserts } = fakeClient({ category: { id: 54, name: "Trasferimento", type: "T" }, bankTxn: salvadanaio });
  const rule = await learnRuleFromCorrection(client, {
    userId: "u1",
    previousCategoryId: 51,
    transaction: { bank_transaction_id: "b9", category_id: 54, type: "T", wallet_id: 1, to_wallet_id: 20 },
  });

  assert.equal(rule.keyword, "salvadanaio");
  assert.equal(upserts[0].payload.type, "E", "uscita dal conto: la regola combacia con i movimenti negativi");
  assert.equal(upserts[0].payload.category_id, 54);
  // Il salvadanaio scelto (to_wallet_id 20) non entra nella regola.
  assert.deepEqual(Object.keys(upserts[0].payload).sort(), ["category_id", "keyword", "source", "type", "updated_at", "user_id"]);
});

test("learnRuleFromCorrection: un trasferimento trasformato in spesa ('Not a transfer') impara la nuova categoria", async () => {
  // Ricarica Revolut importata come T da assegnare (regola `revolut dublin` -> Trasferimento 54):
  // l'utente la trasforma in spesa "Revolut" (72). La regola, stessa chiave e stesso tipo E,
  // viene riscritta: le ricariche successive arrivano gia' come spesa.
  const ricarica = { description: "PAGAMENTO POS EFFETTUATO IL 17/09/2026 MEDIANTE LA CARTA 5167 PRESSO Revolut**8371* Dublin", counterparty: "", amount: -100 };
  const { client, upserts } = fakeClient({ category: { id: 72, name: "Revolut", type: "E" }, bankTxn: ricarica });
  const rule = await learnRuleFromCorrection(client, {
    userId: "u1",
    previousCategoryId: 54,
    transaction: { bank_transaction_id: "b7", category_id: 72, type: "E", wallet_id: 1, to_wallet_id: null },
  });

  assert.equal(rule.keyword, "revolut dublin");
  assert.equal(upserts[0].payload.type, "E");
  assert.equal(upserts[0].payload.category_id, 72);
  assert.deepEqual(upserts[0].options, { onConflict: "user_id,type,keyword" });
});


// ---------------------------------------------------------------------------
// Fase 5 (11/11/2026): rimborsi e testo libero dei bonifici. Nomi inventati.
// ---------------------------------------------------------------------------

const TARI = "ACCR BON ISTANT COD. DISP.: 0126111070157926 CASH NOTPROVIDED Rata 4 tari Bonifico a Vostro favore disposto da: MITT.: Luca Verdi BENEF.: Mario Rossi BIC. ORD.: REVOITM2XXX";
const CONDOMINIO = "ACCR BON ISTANT COD. DISP.: 0126100566660162 CASH NOTPROVIDED Condominio settembre + rate vecchie Bonifico a Vostro favore disposto da: MITT.: Luca Verdi BENEF.: Mario Rossi";
const PAYPAL = "ACCR BON ISTANT COD. DISP.: 0126110968385567 CASH 26110914036427434 INSTANT TRANSFER Bonifico a Vostro favore disposto da: MITT.: PAYPAL BENEF.: Mario Rossi";

test("extractFreeText e freeTextKey: il testo dell'utente, senza mesi, rate e PayPal", () => {
  assert.equal(extractFreeText(TARI), "rata tari");
  assert.equal(freeTextKey(TARI), "tari");
  assert.equal(freeTextKey(CONDOMINIO), "condominio");
  assert.equal(extractFreeText(PAYPAL), "");
  assert.equal(freeTextKey(PAYPAL), "");
  assert.equal(extractFreeText("PAGAM. TRAMITE POS CONAD"), "");
});

test("findMatchingRule: una regola sul testo vince su una regola sulla persona, anche se piu' corta", () => {
  const rules = [
    { keyword: "da luca verdi", type: "I", category_id: 58 },
    { keyword: "tari", type: "I", category_id: 12 },
  ];
  const text = `${TARI} | da luca verdi`;
  assert.equal(findMatchingRule(text, "I", rules).category_id, 12);
  // Senza testo libero la persona resta l'unica indicazione (verso "Persone — da classificare").
  assert.equal(findMatchingRule(`${PAYPAL} | da luca verdi`, "I", rules).category_id, 58);
  assert.equal(findMatchingRule("ACCR. BANCOMAT PAY Da LUCA VERDI data: 10.11 | da luca verdi", "I", rules).category_id, 58);
});

test("categorizeWithRules: una regola in entrata verso una categoria di spesa e' un rimborso valido", () => {
  const result = categorizeWithRules(
    [{ ref: "r1", type: "I", description: TARI, counterparty: "" }],
    { rules: [{ keyword: "tari", type: "I", category_id: 12 }], categories: [{ id: 12, type: "E", active: true }] }
  );
  assert.equal(result.get("r1"), 12);
});

test("learnRuleFromCorrection: un rimborso impara dal testo libero, mai dal nome di chi lo manda", async () => {
  const refund = { bank_transaction_id: "b2", category_id: 12, type: "I", is_refund: true };
  const conTesto = fakeClient({ category: { id: 12, name: "Bollette", type: "E" }, bankTxn: { description: TARI, counterparty: "", amount: 30.33 } });
  const rule = await learnRuleFromCorrection(conTesto.client, { userId: "u1", previousCategoryId: 58, transaction: refund });
  assert.equal(rule.keyword, "tari");
  assert.equal(conTesto.upserts[0].payload.type, "I");
  assert.equal(conTesto.upserts[0].payload.category_id, 12);

  const senzaTesto = fakeClient({ category: { id: 12, name: "Uscite", type: "E" }, bankTxn: { description: PAYPAL, counterparty: "", amount: 36 } });
  assert.equal(await learnRuleFromCorrection(senzaTesto.client, { userId: "u1", previousCategoryId: 58, transaction: refund }), null);
  assert.equal(senzaTesto.upserts.length, 0);
});

test("learnRuleFromCorrection: un'entrata normale con una categoria di spesa (senza is_refund) non impara", async () => {
  const wrong = fakeClient({ category: { id: 12, name: "Bollette", type: "E" }, bankTxn: { description: TARI, counterparty: "", amount: 30.33 } });
  assert.equal(
    await learnRuleFromCorrection(wrong.client, { userId: "u1", previousCategoryId: 58, transaction: { bank_transaction_id: "b2", category_id: 12, type: "I" } }),
    null
  );
});

test("merchantLabel: nome leggibile per il riquadro To review", async () => {
  const { merchantLabel } = await import("./categoryRules.js");
  assert.equal(
    merchantLabel("PAGAM. BANCOMATPAY presso PAGOPA data: 11.11 ore: 20:25 identific.univoco transazione: P2B0003"),
    "Pagopa"
  );
  assert.equal(
    merchantLabel("INVIO BANCOMAT PAY Verso MICHELE SCALDARELLA data: 09.11 IBAN Benef."),
    "To Michele Scaldarella"
  );
  assert.equal(merchantLabel(""), "");
});
