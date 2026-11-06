/**
 * Categorizzazione locale dei movimenti bancari con regole "parola chiave -> categoria"
 * (tabella `category_rules`, migrazione 010). Nessun servizio esterno: descrizioni e
 * importi non escono da Flow-Wise.
 *
 * - `normalizeForRules` porta testi e parole chiave nella stessa forma: minuscole, senza
 *   accenti, solo lettere separate da uno spazio. Le cifre spariscono, cosi' anche
 *   "VIALE DEI14/07" diventa "viale dei".
 * - Una regola combacia se la sua parola chiave compare a parole intere nel testo
 *   (descrizione + controparte). Tra piu' regole vince la piu' lunga, a pari lunghezza la
 *   piu' recente.
 * - `extractMerchantKey` ricava dal movimento il nome del negozio o della controparte, nei
 *   formati delle descrizioni Intesa Sanpaolo visti nei dati. Serve a imparare una regola
 *   da una correzione e a proporre le regole iniziali.
 */

/** Parole che compaiono in quasi tutti i movimenti e non dicono niente sul negozio. */
const GENERIC_WORDS = new Set(
  `srl spa sas snc sarl sca cie srls s r l et e di da del dei della delle il la lo le
  via viale piazza corso largo lungomare lungomar loc localita
  roma milano napoli italia italy it data ore`.split(/\s+/)
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
 * Categoria per ogni movimento: Map ref -> categoryId, oppure null se nessuna regola
 * combacia o la regola punta a una categoria non attiva o di un altro tipo.
 * @param {Array<{ref, type, description, counterparty}>} items
 */
export const categorizeWithRules = (items, { rules, categories }) => {
  const activeTypeById = new Map(
    categories.filter((c) => c.active !== false).map((c) => [Number(c.id), c.type])
  );
  const result = new Map();
  for (const item of items) {
    const rule = findMatchingRule(`${item.description ?? ""} ${item.counterparty ?? ""}`, item.type, rules);
    const categoryId = rule ? Number(rule.category_id) : null;
    result.set(
      item.ref,
      categoryId != null && activeTypeById.get(categoryId) === item.type ? categoryId : null
    );
  }
  return result;
};

export const loadRules = async (client, userId) => {
  const { data, error } = await client
    .from("category_rules")
    .select("keyword, type, category_id, updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Lettura regole di categoria fallita: ${error.message}`);
  return data ?? [];
};

export const upsertRule = async (client, { userId, keyword, type, categoryId, source = "manual" }) => {
  if (!isValidKeyword(keyword)) throw new Error("Parola chiave non valida");
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
  if (error) throw new Error(`Impossibile salvare la regola: ${error.message}`);
  return data;
};

const isFallbackCategoryName = (name) => normalizeForRules(name) === "altro";

/**
 * Impara una regola dalla correzione di un movimento importato dalla banca.
 * Chiamata dopo un PUT /transaction/:id riuscito. Non fa niente se:
 * - il movimento non viene dalla banca (`bank_transaction_id` vuoto);
 * - la categoria non e' cambiata;
 * - la nuova categoria e' 'Altro' (un ripiego non deve diventare una regola);
 * - dal movimento non si ricava un nome di negozio o controparte.
 * Restituisce la regola salvata, o null.
 */
export const learnRuleFromCorrection = async (client, { userId, previousCategoryId, transaction }) => {
  if (!transaction?.bank_transaction_id) return null;
  if (Number(previousCategoryId) === Number(transaction.category_id)) return null;
  if (transaction.type !== "I" && transaction.type !== "E") return null;

  const { data: category, error: categoryError } = await client
    .from("Category")
    .select("id, name, type")
    .eq("id", transaction.category_id)
    .eq("userid", userId)
    .maybeSingle();
  if (categoryError) throw new Error(`Lettura categoria fallita: ${categoryError.message}`);
  if (!category || category.type !== transaction.type || isFallbackCategoryName(category.name)) return null;

  const { data: bankTxn, error: bankError } = await client
    .from("bank_transactions")
    .select("description, counterparty")
    .eq("id", transaction.bank_transaction_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (bankError) throw new Error(`Lettura movimento bancario fallita: ${bankError.message}`);
  if (!bankTxn) return null;

  const keyword = extractMerchantKey(bankTxn.description, bankTxn.counterparty);
  if (!isValidKeyword(keyword)) return null;

  return upsertRule(client, {
    userId,
    keyword,
    type: transaction.type,
    categoryId: category.id,
    source: "learned",
  });
};
