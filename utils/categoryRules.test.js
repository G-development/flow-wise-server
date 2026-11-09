import test from "node:test";
import assert from "node:assert/strict";
import {
  categorizeWithRules,
  extractMerchantKey,
  findMatchingRule,
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
