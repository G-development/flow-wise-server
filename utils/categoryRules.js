/**
 * Categorizzazione locale dei movimenti bancari con regole "parola chiave -> categoria"
 * (tabella `category_rules`, migrazione 010). Nessun servizio esterno: descrizioni e
 * importi non escono da Flow-Wise.
 *
 * - `normalizeForRules` porta testi e parole chiave nella stessa forma: minuscole, senza
 *   accenti, solo lettere separate da uno spazio. Le cifre spariscono, cosi' anche
 *   "VIALE DEI14/07" diventa "viale dei".
 * - Una regola combacia se la sua parola chiave compare a parole intere nel testo
 *   (descrizione + controparte). Una regola sulla controparte ("da …", "verso …") perde
 *   sempre contro una regola su altre parole (es. il testo libero del bonifico "Rata 4 tari"):
 *   il nome di una persona non dice cosa sta pagando (fase 5, deciso da Gio l'11/11/2026).
 *   A parita' di genere vince la piu' lunga, a pari lunghezza la piu' recente.
 * - Una regola di tipo `I` che punta a una categoria di spesa (`E`) crea un **rimborso**
 *   (fase 5, migrazione 014): `buildAppTransactionFromBank` lo marca `is_refund`.
 * - `extractMerchantKey` ricava dal movimento il nome del negozio o della controparte, nei
 *   formati delle descrizioni Intesa Sanpaolo visti nei dati. Serve a imparare una regola
 *   da una correzione e a proporre le regole iniziali.
 */

/** Parole che compaiono in quasi tutti i movimenti e non dicono niente sul negozio. */
const GENERIC_WORDS = new Set(
  `srl spa sas snc sarl sca cie srls s r l et e di da del dei della delle il la lo le
  via viale piazza corso largo lungomare lungomar loc localita
  roma milano napoli italia italy it data ore
  pagam pagamento tramite pos carta identific univoco transazione iban benef`.split(/\s+/)
);

export const normalizeForRules = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

/** Parole con cui comincia un indirizzo: il nome del negozio finisce prima. */
const ADDRESS_WORDS = new Set("via viale piazza piazzale corso largo lungomare lungomar loc localita".split(" "));

/** Prime parole significative (massimo `maxWords`) di un frammento, prima dell'indirizzo. */
const keyFromFragment = (fragment, maxWords = 2) => {
  const words = normalizeForRules(fragment).split(" ");
  const addressAt = words.findIndex((word, index) => index > 0 && ADDRESS_WORDS.has(word));
  return (addressAt > 0 ? words.slice(0, addressAt) : words)
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word))
    .slice(0, maxWords)
    .join(" ");
};

/**
 * Formati delle descrizioni Intesa (dal piu' specifico al piu' generico). Ogni voce
 * restituisce il frammento che contiene il nome; `prefix` distingue persone e servizi che
 * altrimenti si confonderebbero (lo stesso nome come mittente o destinatario).
 */
const MERCHANT_PATTERNS = [
  { re: /movim\. salvadanaio|movimento salvadanaio|salvadanaio/i, fixed: "salvadanaio" },
  { re: /presso\s+(.+?)(?:\s*\(|$)/i },
  { re: /pagam\. tramite pos\s+(?:pagamento su pos\s+)?(.+?)(?:\d{2}\/\d{2}-\d{2}:\d{2}|\s-\s|carta n|$)/i },
  { re: /bancomat pay\s+verso\s+(.+?)\s+data/i, prefix: "verso" },
  { re: /bancomat pay\s+da\s+(.+?)\s+data/i, prefix: "da" },
  { re: /a favore di:?\s+(.+?)(?:\s+mandato|$)/i, prefix: "verso" },
  { re: /mitt\.:\s*(.+?)\s+benef\./i, prefix: "da" },
  { re: /nome azienda\s+(.+?)\s+codice azienda/i },
  { re: /\bnome\s+(.+?)\s+mandato/i },
  { re: /^(.+?)(?:\d{2}\/\d{2}\d{4}|\s+carta n)/i },
];

/**
 * Nome del negozio o della controparte di un movimento bancario, normalizzato
 * (es. "conad supermercato", "verso michele scaldarella"). Stringa vuota se non trovato.
 */
export const extractMerchantKey = (description, counterparty = "") => {
  const text = String(description ?? "");
  for (const { re, fixed, prefix } of MERCHANT_PATTERNS) {
    const match = text.match(re);
    if (!match) continue;
    if (fixed) return fixed;
    const key = keyFromFragment(match[1]);
    if (key) return prefix ? `${prefix} ${key}` : key;
  }
  return keyFromFragment(counterparty) || keyFromFragment(text);
};

/**
 * Nome leggibile di un movimento arrivato dalla banca (14/11/2026, riquadro "To review"): il negozio
 * o la controparte riconosciuti da `extractMerchantKey`, con le iniziali maiuscole
 * ("pagopa" -> "Pagopa", "verso michele scaldarella" -> "To Michele Scaldarella"). "" se non trovato.
 */
export const merchantLabel = (description, counterparty = "") => {
  const key = extractMerchantKey(description, counterparty);
  if (!key) return "";
  const words = key.split(" ");
  const lead = words[0] === "verso" ? "To" : words[0] === "da" ? "From" : null;
  const rest = (lead ? words.slice(1) : words).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return [lead, ...rest].filter(Boolean).join(" ");
};

/**
 * Testo libero di un bonifico in entrata, normalizzato, o "". Nei movimenti Intesa sta tra il
 * codice dopo "CASH" e "Bonifico a Vostro favore" ("… CASH NOTPROVIDED Rata 4 tari Bonifico a
 * Vostro favore disposto da: MITT.: …"); "INSTANT TRANSFER" (PayPal) non e' testo dell'utente.
 */
export const extractFreeText = (description) => {
  const match = String(description ?? "").match(/\bCASH\s+\S+\s+(.*?)\s*Bonifico a Vostro favore/i);
  if (!match) return "";
  return normalizeForRules(match[1].replace(/instant transfer/gi, ""));
};

/** Parole del testo libero che non dicono cosa si paga: mesi, rate, saldi. */
const FREE_TEXT_NOISE = new Set(
  `rata rate quota quote saldo saldi acconto vecchie vecchia mese mesi anno
  gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre`.split(/\s+/)
);

/** Parola chiave da imparare dal testo libero ("rata tari" -> "tari", "condominio settembre" -> "condominio"). */
export const freeTextKey = (description) =>
  extractFreeText(description)
    .split(" ")
    .find((word) => word.length >= 3 && !GENERIC_WORDS.has(word) && !FREE_TEXT_NOISE.has(word)) ?? "";

/** Regola costruita sulla controparte (persona o azienda): vale meno di una sul testo. */
const isCounterpartyRule = (keyword) => /^(da|verso) /.test(String(keyword));

/** Una parola chiave e' valida se, normalizzata, ha almeno 3 lettere. */
export const isValidKeyword = (keyword) => {
  const normalized = normalizeForRules(keyword);
  return normalized.length >= 3 && normalized === String(keyword);
};

/**
 * Regola che combacia con il testo del movimento, o null.
 * @param {string} text descrizione + controparte (grezze: vengono normalizzate qui)
 * @param {"I"|"E"} type
 * @param {Array<{keyword, type, category_id, updated_at?}>} rules
 */
export const findMatchingRule = (text, type, rules) => {
  const haystack = ` ${normalizeForRules(text)} `;
  let best = null;
  for (const rule of rules) {
    if (rule.type !== type || !rule.keyword) continue;
    if (!haystack.includes(` ${rule.keyword} `)) continue;
    if (best && isCounterpartyRule(rule.keyword) !== isCounterpartyRule(best.keyword)) {
      if (!isCounterpartyRule(rule.keyword)) best = rule;
      continue;
    }
    if (
      !best ||
      rule.keyword.length > best.keyword.length ||
      (rule.keyword.length === best.keyword.length &&
        String(rule.updated_at ?? "") > String(best.updated_at ?? ""))
    ) {
      best = rule;
    }
  }
  return best;
};

/**
 * Testo su cui si cercano le regole: descrizione, controparte e il nome estratto.
 * Il nome estratto serve alle chiavi con prefisso ("verso anna bianchi", "da luca verdi"):
 * "verso"/"da" non compaiono nel testo di un bonifico ("a favore di: Anna Bianchi"), quindi
 * senza di esso una regola imparata da una correzione non combacerebbe mai.
 */
export const ruleTextFor = (description, counterparty = "") =>
  `${description ?? ""} ${counterparty ?? ""} | ${extractMerchantKey(description, counterparty)}`;

/**
 * Categoria per ogni movimento: Map ref -> categoryId, oppure null se nessuna regola
 * combacia o la regola punta a una categoria non attiva o di un altro tipo.
 * La categoria di sistema "Trasferimento" (tipo `T`, migrazione 011) va bene per
 * qualsiasi segno: il movimento diventa un trasferimento (`buildAppTransactionFromBank`).
 * Una categoria di spesa va bene anche per un movimento in entrata: e' un rimborso (014).
 * @param {Array<{ref, type, description, counterparty}>} items
 */
export const categorizeWithRules = (items, { rules, categories }) => {
  const activeTypeById = new Map(
    categories.filter((c) => c.active !== false).map((c) => [Number(c.id), c.type])
  );
  const result = new Map();
  for (const item of items) {
    const rule = findMatchingRule(ruleTextFor(item.description, item.counterparty), item.type, rules);
    const categoryId = rule ? Number(rule.category_id) : null;
    result.set(
      item.ref,
      categoryId != null &&
        (activeTypeById.get(categoryId) === item.type ||
          activeTypeById.get(categoryId) === "T" ||
          (item.type === "I" && activeTypeById.get(categoryId) === "E"))
        ? categoryId
        : null
    );
  }
  return result;
};

export const loadRules = async (client, userId) => {
  const { data, error } = await client
    .from("category_rules")
    .select("keyword, type, category_id, updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Reading category rules failed: ${error.message}`);
  return data ?? [];
};

export const upsertRule = async (client, { userId, keyword, type, categoryId, source = "manual" }) => {
  if (!isValidKeyword(keyword)) throw new Error("Invalid keyword");
  const { data, error } = await client
    .from("category_rules")
    .upsert(
      {
        user_id: userId,
        keyword,
        type,
        category_id: Number(categoryId),
        source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,type,keyword" }
    )
    .select("keyword, type, category_id, source")
    .single();
  if (error) throw new Error(`Could not save the rule: ${error.message}`);
  return data;
};

// "Altro" per gli account storici, "Other" per quelli nuovi (13/11/2026): un ripiego non diventa una regola.
const isFallbackCategoryName = (name) => ["altro", "other"].includes(normalizeForRules(name));

/**
 * Impara una regola dalla correzione di un movimento importato dalla banca.
 * Chiamata dopo un PUT /transaction/:id riuscito. Non fa niente se:
 * - il movimento non viene dalla banca (`bank_transaction_id` vuoto);
 * - la categoria non e' cambiata;
 * - la nuova categoria e' 'Altro' (un ripiego non deve diventare una regola);
 * - dal movimento non si ricava un nome di negozio o controparte.
 * Una correzione verso la categoria "Trasferimento" (`T`) impara la categoria con il
 * tipo del segno del movimento (`category_rules.type` resta `I`/`E`), mai il wallet:
 * assegnare un accantonamento a un salvadanaio non deve decidere per i successivi.
 * Restituisce la regola salvata, o null.
 */
export const learnRuleFromCorrection = async (client, { userId, previousCategoryId, transaction }) => {
  if (!transaction?.bank_transaction_id) return null;
  if (Number(previousCategoryId) === Number(transaction.category_id)) return null;
  if (!["I", "E", "T"].includes(transaction.type)) return null;

  const { data: category, error: categoryError } = await client
    .from("Category")
    .select("id, name, type")
    .eq("id", transaction.category_id)
    .eq("userid", userId)
    .maybeSingle();
  if (categoryError) throw new Error(`Reading the category failed: ${categoryError.message}`);
  const isRefund = transaction.is_refund === true;
  const expectedType = isRefund ? "E" : transaction.type;
  if (!category || category.type !== expectedType || isFallbackCategoryName(category.name)) return null;

  const { data: bankTxn, error: bankError } = await client
    .from("bank_transactions")
    .select("description, counterparty, amount")
    .eq("id", transaction.bank_transaction_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (bankError) throw new Error(`Reading the bank movement failed: ${bankError.message}`);
  if (!bankTxn) return null;

  // Un rimborso si impara solo dal testo libero del bonifico ("tari", "condominio"), mai dal
  // nome di chi lo manda: lo stesso amico rimborsa sia la luce sia la pizza.
  const keyword = isRefund
    ? freeTextKey(bankTxn.description)
    : extractMerchantKey(bankTxn.description, bankTxn.counterparty);
  if (!isValidKeyword(keyword)) return null;

  return upsertRule(client, {
    userId,
    keyword,
    // Le regole combaciano sul segno del movimento: per una `T` lo dice l'importo bancario.
    type: transaction.type === "T" ? (Number(bankTxn.amount) >= 0 ? "I" : "E") : transaction.type,
    categoryId: category.id,
    source: "learned",
  });
};
