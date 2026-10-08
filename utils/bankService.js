import axios from "axios";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GOCARDLESS_API_BASE = "https://bankaccountdata.gocardless.com/api/v2";

// Cache token GoCardless in memoria
let cachedGoCardlessToken = {
  token: null,
  expiresAt: 0,
};

// Fallback secret for AES-GCM state encryption, required to be set in production
const getEncryptionSecret = () => {
  const secret = process.env.BANK_CLIENT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("Bank integration secret (BANK_CLIENT_SECRET or SUPABASE_SERVICE_ROLE_KEY) is missing");
  }
  return secret;
};

/**
 * Ottiene il token di accesso alle API di GoCardless
 */
export const getGoCardlessToken = async () => {
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;

  if (!secretId || !secretKey) {
    throw new Error("GoCardless secret_id or secret_key is not configured in .env");
  }

  // Riutilizza il token se ancora valido (con 5 minuti di buffer)
  if (
    cachedGoCardlessToken.token &&
    Date.now() < cachedGoCardlessToken.expiresAt - 300000
  ) {
    return cachedGoCardlessToken.token;
  }

  try {
    const response = await axios.post(`${GOCARDLESS_API_BASE}/token/new/`, {
      secret_id: secretId,
      secret_key: secretKey,
    });

    const { access, access_expires } = response.data;
    cachedGoCardlessToken = {
      token: access,
      expiresAt: Date.now() + (access_expires || 86400) * 1000,
    };

    return access;
  } catch (error) {
    const msg = error.response?.data?.detail || error.message;
    throw new Error(`GoCardless Authentication Failed: ${msg}`);
  }
};

/**
 * Banche popolari italiane preconfigurate (con mapping ID GoCardless)
 */
export const POPULAR_BANKS = [
  {
    id: "SANDBOXFINANCE_SBA00000",
    name: "FlowWise Test Bank (Sandbox PSD2)",
    color: "#0284c7",
    type: "sandbox",
    bic: "SANDBOX",
  },
  {
    id: "INTESA_SANPAOLO_IT_BCITITMM",
    name: "Intesa Sanpaolo",
    color: "#006643",
    type: "live",
    bic: "BCITITMM",
    aliases: ["intesa"],
  },
  {
    id: "UNICREDIT_IT_UNCRITM1",
    name: "UniCredit",
    color: "#e2001a",
    type: "live",
    bic: "UNCRITM1",
    aliases: ["unicredit"],
  },
  {
    id: "POSTE_ITALIANE_IT_POSOIT22",
    name: "Poste Italiane (BancoPosta)",
    color: "#fbc02d",
    type: "live",
    bic: "POSOIT22",
    aliases: ["poste"],
  },
  {
    id: "REVOLUT_EU_REVOEE22",
    name: "Revolut",
    color: "#0075eb",
    type: "live",
    bic: "REVOEE22",
    aliases: ["revolut"],
  },
  {
    id: "FINECO_IT_FECOITMM",
    name: "Fineco Bank",
    color: "#003b70",
    type: "live",
    bic: "FECOITMM",
    aliases: ["fineco"],
  },
  {
    id: "BNL_IT_BNLIITRR",
    name: "BNL - BNP Paribas",
    color: "#00915a",
    type: "live",
    bic: "BNLIITRR",
    aliases: ["bnl"],
  },
  {
    id: "BANCO_BPM_IT_BAPPIT21",
    name: "Banco BPM",
    color: "#1e3a8a",
    type: "live",
    bic: "BAPPIT21",
    aliases: ["bpm"],
  },
  {
    id: "N26_IT_NTSBITB1",
    name: "N26",
    color: "#36a18b",
    type: "live",
    bic: "NTSBITB1",
    aliases: ["n26"],
  },
  {
    id: "MEDIANET_CREDEM_IT_CRDMIT22",
    name: "Credem",
    color: "#d97706",
    type: "live",
    bic: "CRDMIT22",
    aliases: ["credem"],
  },
  {
    id: "ILLIMITY_IT_ILBKITMM",
    name: "Illimity Bank",
    color: "#8b5cf6",
    type: "live",
    bic: "ILBKITMM",
    aliases: ["illimity"],
  },
];

/**
 * Ottiene la lista degli istituti supportati
 */
export const getSupportedBanks = async () => {
  const secretId = process.env.GOCARDLESS_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_SECRET_KEY;

  // Se GoCardless è configurato, possiamo caricare tutte le banche italiane ufficiali
  if (secretId && secretKey) {
    try {
      const token = await getGoCardlessToken();
      const response = await axios.get(
        `${GOCARDLESS_API_BASE}/institutions/?country=IT`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const liveInstitutions = response.data.map((inst) => {
        const popular = POPULAR_BANKS.find(
          (p) => p.id === inst.id || (p.bic && p.bic === inst.bic)
        );
        return {
          id: inst.id,
          name: inst.name,
          bic: inst.bic,
          logo: inst.logo,
          color: popular?.color || "#2563eb",
          type: inst.id.includes("SANDBOX") ? "sandbox" : "live",
        };
      });

      // Assicuriamoci che la Sandbox e le principali banche siano in cima
      const sorted = [
        ...POPULAR_BANKS.filter((p) => p.id === "SANDBOXFINANCE_SBA00000"),
        ...liveInstitutions.filter((i) => i.id !== "SANDBOXFINANCE_SBA00000"),
      ];

      return sorted;
    } catch (err) {
      console.warn("Could not fetch remote GoCardless institutions, using preset list:", err.message);
    }
  }

  // Fallback se offline o non configurato
  return POPULAR_BANKS.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    type: b.type,
    bic: b.bic,
  }));
};

/**
 * Controlla lo stato di configurazione dell'integrazione bancaria
 */
export const getBankSetupStatus = async () => {
  const issues = [];
  const hasGoCardless = !!(
    process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY
  );

  // Verifica tabelle nel DB Supabase
  for (const table of ["bank_connections", "bank_transactions"]) {
    const { error } = await supabase.from(table).select("id").limit(1);
    if (error) {
      const isMissingTable =
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        /could not find the table|does not exist/i.test(error.message);
      issues.push({
        code: isMissingTable ? "database_not_migrated" : "database_unavailable",
        message: isMissingTable
          ? `Tabella ${table} non presente: applica le migrazioni bancarie nel database Supabase.`
          : `Impossibile verificare la tabella ${table} nel database (${error.message}).`,
      });
    }
  }

  return {
    ready: issues.length === 0,
    provider: hasGoCardless ? "gocardless" : "mock",
    isRealBankEnabled: hasGoCardless,
    issues,
  };
};

/**
 * Crea lo state cifrato per OAuth con AES-256-GCM
 */
export const createBankOAuthState = (userId, bankId, extra = {}) => {
  const secret = getEncryptionSecret();
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const payload = Buffer.from(
    JSON.stringify({
      userId,
      bankId,
      ...extra,
      expiresAt: Date.now() + 20 * 60 * 1000, // 20 minuti
      nonce: randomBytes(16).toString("hex"),
    })
  );

  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
};

/**
 * Verifica e decifra lo state OAuth
 */
export const verifyBankOAuthState = (state) => {
  if (typeof state !== "string" || !state) {
    throw new Error("Invalid OAuth state");
  }

  const [encodedIv, encodedPayload, encodedTag, extra] = state.split(".");
  if (!encodedIv || !encodedPayload || !encodedTag || extra !== undefined) {
    throw new Error("Invalid OAuth state format");
  }

  let payload;
  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const encrypted = Buffer.from(encodedPayload, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
      throw new Error("Invalid OAuth state segment length");
    }

    const secret = getEncryptionSecret();
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    payload = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Invalid or corrupted OAuth state");
  }

  let stateData;
  try {
    stateData = JSON.parse(payload);
  } catch {
    throw new Error("Failed to parse OAuth state payload");
  }

  if (
    typeof stateData.userId !== "string" ||
    typeof stateData.bankId !== "string" ||
    typeof stateData.expiresAt !== "number" ||
    stateData.expiresAt < Date.now()
  ) {
    throw new Error("Expired or invalid OAuth state");
  }

  return stateData;
};

/**
 * Genera l'URL di autorizzazione GoCardless (o Mock Sandbox)
 */
export const getAuthorizationUrl = async (userId, bankId) => {
  const hasGoCardless = !!(
    process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY
  );
  const serverBase =
    process.env.SERVER_BASE_URL ||
    `http://localhost:${process.env.PORT || 5030}`;
  const callbackUrl =
    process.env.BANK_REDIRECT_URI || `${serverBase}/bank/callback`;

  // Normalizza l'ID istituto (se viene passato un alias es. "intesa")
  let normalizedBankId = bankId;
  const popular = POPULAR_BANKS.find(
    (b) => b.id === bankId || b.aliases?.includes(bankId)
  );
  if (popular) {
    normalizedBankId = popular.id;
  }

  // Se GoCardless è disponibile o configurato
  if (hasGoCardless) {
    // In produzione il callback deve essere un URL pubblico, non localhost
    if (!process.env.BANK_REDIRECT_URI && !process.env.SERVER_BASE_URL) {
      throw new Error(
        "Configurazione errata: imposta BANK_REDIRECT_URI (o SERVER_BASE_URL) con un URL pubblico per usare GoCardless."
      );
    }

    try {
      const token = await getGoCardlessToken();
      const state = createBankOAuthState(userId, normalizedBankId);

      // Crea l'accordo e la requisition su GoCardless.
      // Passiamo lo state cifrato direttamente nella redirect URL:
      // GoCardless lo rimanda invariato nel callback (param `state`).
      const requisitionRes = await axios.post(
        `${GOCARDLESS_API_BASE}/requisitions/`,
        {
          redirect: `${callbackUrl}?state=${encodeURIComponent(state)}`,
          institution_id: normalizedBankId,
          reference: state.slice(0, 30),
          user_language: "IT",
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const { link, id: requisitionId } = requisitionRes.data;

      if (!link || !requisitionId) {
        throw new Error(
          "GoCardless non ha restituito un link e/o un requisitionId di autorizzazione."
        );
      }

      // Salviamo una "connessione in attesa" per poter recuperare il requisitionId
      // nel callback, anche se lo state non lo include.
      // Nota: in produzione, ensureValidToken userà comunque token GoCardless
      // direttamente; questo placeholder evita di cadere nel flusso mock.
      await saveBankConnection(userId, normalizedBankId, "pending_account", {
        // Usiamo lo *state cifrato* come placeholder per riconoscere
        // il callback GoCardless e risalire al requisitionId.
        accessToken: state,
        refreshToken: requisitionId,
        expiresIn: 20 * 60, // 20 minuti
      });

      return link;
    } catch (err) {
      console.error(
        "GoCardless Requisition Error:",
        err.response?.data || err.message
      );
      throw new Error(`Errore GoCardless: ${err.message}`);
    }
  }

  // Modalità Mock Sandbox Interattiva
  const state = createBankOAuthState(userId, normalizedBankId);
  return `${serverBase}/bank/mock-auth?state=${encodeURIComponent(state)}&bank=${encodeURIComponent(normalizedBankId)}`;
};

/**
 * Sincronizza i conti e le transazioni da GoCardless Requisition
 */
export const handleGoCardlessCallback = async (userId, bankId, requisitionId) => {
  const token = await getGoCardlessToken();

  // Recupera i dettagli della requisition
  const reqRes = await axios.get(
    `${GOCARDLESS_API_BASE}/requisitions/${requisitionId}/`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const { accounts, status } = reqRes.data;

  if (!accounts || accounts.length === 0) {
    throw new Error(`Nessun conto associato a questa autorizzazione (Stato: ${status})`);
  }

  const accountId = accounts[0];

  // Salva la connessione con ID Requisition e Account ID
  await saveBankConnection(userId, bankId, accountId, {
    accessToken: token,
    refreshToken: requisitionId,
    expiresIn: 7776000, // 90 giorni PSD2
  });

  // Sincronizza subito i movimenti del conto
  return await syncBankTransactions(userId, bankId, accountId, token);
};

/**
 * Genera movimenti bancari realistici per sandbox/mock
 */
const generateMockBankTransactions = (bankId, accountId, count = 25) => {
  const now = new Date();
  const sampleTransactions = [
    { desc: "Stipendio Mensile - Bonifico SEPA", amount: 2250.00, counterparty: "Datatech Solutions SRL", category: "Stipendio" },
    { desc: "Spesa Supermercato Esselunga", amount: -76.40, counterparty: "Esselunga Superstore", category: "Alimentari" },
    { desc: "Rifornimento Carburante Eni Station", amount: -50.00, counterparty: "Eni Live Station", category: "Trasporti" },
    { desc: "Bonifico Affitto Abitazione", amount: -650.00, counterparty: "Immobiliare Milano S.r.l.", category: "Casa" },
    { desc: "Bolletta Enel Energia Elettrica", amount: -84.30, counterparty: "Enel Energia S.p.A.", category: "Utenze" },
    { desc: "Ristorante Pizzeria La Pergola", amount: -36.50, counterparty: "Pizzeria La Pergola", category: "Ristoranti" },
    { desc: "Abbonamento Netflix Premium", amount: -17.99, counterparty: "Netflix Services", category: "Intrattenimento" },
    { desc: "Abbonamento Spotify Mensile", amount: -10.99, counterparty: "Spotify AB", category: "Intrattenimento" },
    { desc: "Acquisto Farmacia San Carlo", amount: -24.80, counterparty: "Farmacia San Carlo", category: "Salute" },
    { desc: "Bonifico Rimborso Spese Trasferta", amount: 145.50, counterparty: "Datatech Solutions SRL", category: "Rimborsi" },
    { desc: "Spesa Conad City", amount: -42.15, counterparty: "Conad City", category: "Alimentari" },
    { desc: "Pranzo Bar Caffè Centrale", amount: -12.50, counterparty: "Bar Caffè Centrale", category: "Ristoranti" },
    { desc: "Bolletta Vodafone Fibra Casa", amount: -29.90, counterparty: "Vodafone Italia S.p.A.", category: "Utenze" },
    { desc: "Biglietto Trenitalia Frecciarossa", amount: -48.00, counterparty: "Trenitalia S.p.A.", category: "Trasporti" },
    { desc: "Acquisto Amazon.it", amount: -39.99, counterparty: "Amazon EU Sarl", category: "Shopping" },
    { desc: "Prelievo Bancomat Sportello", amount: -100.00, counterparty: `Sportello ATM`, category: "Prelievo" },
    { desc: "Ricarica Iliad Mobile", amount: -9.99, counterparty: "Iliad Italia", category: "Utenze" },
    { desc: "Cena Trattoria Da Mario", amount: -54.00, counterparty: "Trattoria Da Mario", category: "Ristoranti" },
    { desc: "Bonifico Progetto Freelance Consulenza", amount: 480.00, counterparty: "Studio Associato Rossi", category: "Extra" },
    { desc: "Palestra FitExpress Abbonamento", amount: -34.90, counterparty: "FitExpress Club", category: "Sport" },
    { desc: "Spesa Bio c' Bon", amount: -28.40, counterparty: "Bio c' Bon", category: "Alimentari" },
    { desc: "Acquisto Libri Feltrinelli", amount: -22.50, counterparty: "Librerie Feltrinelli", category: "Cultura" },
    { desc: "Cinema The Space Biglietti", amount: -19.00, counterparty: "The Space Cinema", category: "Intrattenimento" },
    { desc: "Pedaggio Autostrade per l'Italia", amount: -14.80, counterparty: "Autostrade per l'Italia", category: "Trasporti" },
    { desc: "Bonifico Cashback / Bonus", amount: 25.00, counterparty: "Satispay Cashback", category: "Extra" },
  ];

  const transactions = [];
  const selectedSamples = sampleTransactions.slice(0, count);

  selectedSamples.forEach((sample, index) => {
    const daysAgo = Math.floor((index * 88) / selectedSamples.length);
    const dateObj = new Date(now);
    dateObj.setDate(now.getDate() - daysAgo);

    const date = dateObj.toISOString().split("T")[0];
    const externalId = `txn_${bankId}_${accountId}_${dateObj.getTime()}_${index + 1}`;

    transactions.push({
      transactionId: externalId,
      amount: sample.amount,
      currency: "EUR",
      bookingDate: date,
      valueDate: date,
      remittanceInformationUnstructured: sample.desc,
      purpose: sample.desc,
      counterparty: { name: sample.counterparty },
      category: sample.category,
    });
  });

  return transactions;
};

/**
 * Ottiene le transazioni di un conto da GoCardless o Mock
 */
export const fetchTransactions = async (
  bankId,
  accessToken,
  accountId,
  fromDate,
  toDate
) => {
  const isGoCardlessAccount =
    accountId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      accountId
    );

  if (isGoCardlessAccount) {
    try {
      const token = await getGoCardlessToken();
      const params = new URLSearchParams();
      if (fromDate) params.append("date_from", fromDate);
      if (toDate) params.append("date_to", toDate);

      const response = await axios.get(
        `${GOCARDLESS_API_BASE}/accounts/${accountId}/transactions/?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const booked = response.data?.transactions?.booked || [];
      const pending = response.data?.transactions?.pending || [];
      const allTxns = [...booked, ...pending];

      return allTxns.map((txn) => {
        const rawAmt = txn.transactionAmount?.amount;
        const amount = typeof rawAmt === "string" ? parseFloat(rawAmt) : Number(rawAmt || 0);
        const date = txn.bookingDate || txn.valueDate || new Date().toISOString().split("T")[0];
        const desc =
          txn.remittanceInformationUnstructured ||
          (Array.isArray(txn.remittanceInformationUnstructuredArray)
            ? txn.remittanceInformationUnstructuredArray.join(" ")
            : "") ||
          txn.creditorName ||
          txn.debtorName ||
          "Transazione Bancaria";
        const counterparty = txn.creditorName || txn.debtorName || "";

        return {
          transactionId:
            txn.transactionId ||
            txn.internalTransactionId ||
            `gc_${accountId}_${date}_${Math.abs(amount)}`,
          amount,
          currency: txn.transactionAmount?.currency || "EUR",
          bookingDate: date,
          remittanceInformationUnstructured: desc,
          purpose: desc,
          counterparty: { name: counterparty },
        };
      });
    } catch (err) {
      console.error("Error fetching transactions from GoCardless:", err.response?.data || err.message);
    }
  }

  // Fallback / Mock
  return generateMockBankTransactions(bankId, accountId, 25);
};

/**
 * Salva la connessione bancaria nel database Supabase
 */
export const saveBankConnection = async (
  userId,
  bankId,
  accountId,
  tokenData
) => {
  const expiresAt = new Date();
  expiresAt.setSeconds(
    expiresAt.getSeconds() + Number(tokenData.expiresIn || 7776000)
  );

  const { error } = await supabase.from("bank_connections").upsert(
    {
      user_id: userId,
      bank_id: bankId,
      account_id: accountId,
      access_token: tokenData.accessToken || "mock_token",
      refresh_token: tokenData.refreshToken || null,
      token_expires_at: expiresAt.toISOString(),
      last_synced: new Date().toISOString(),
    },
    { onConflict: "user_id,bank_id" }
  );

  if (error) throw new Error(`Failed to save bank connection: ${error.message}`);
};

/**
 * Recupera una connessione bancaria attiva per l'utente
 */
export const getBankConnection = async (userId, bankId) => {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("bank_id", bankId)
    .single();

  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return data;
};

/**
 * Recupera tutte le connessioni bancarie di un utente
 */
export const getUserBankConnections = async (userId) => {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};

/**
 * Sincronizza i movimenti bancari e li salva nel DB
 */
export const syncBankTransactions = async (
  userId,
  bankId,
  accountId,
  accessToken
) => {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);

  const dateFrom = fromDate.toISOString().split("T")[0];
  const dateTo = toDate.toISOString().split("T")[0];

  const transactions = await fetchTransactions(
    bankId,
    accessToken,
    accountId,
    dateFrom,
    dateTo
  );

  const formatted = transactions.map((txn) => {
    const externalIdValue = txn.transactionId ?? txn.id;
    const externalId =
      externalIdValue === undefined || externalIdValue === null
        ? ""
        : String(externalIdValue);
    const amount = Number(txn.amount ?? txn.transactionAmount?.amount);
    const date = txn.bookingDate || txn.date || txn.valueDate;

    if (
      !externalId ||
      !Number.isFinite(amount) ||
      typeof date !== "string" ||
      Number.isNaN(Date.parse(date))
    ) {
      throw new Error("Bank provider returned a transaction with invalid fields");
    }

    return {
      user_id: userId,
      bank_id: bankId,
      account_id: accountId,
      external_id: externalId,
      amount,
      currency: txn.currency || "EUR",
      description: txn.purpose || txn.remittanceInformationUnstructured || "",
      date,
      counterparty:
        typeof txn.counterparty === "string"
          ? txn.counterparty
          : txn.counterparty?.name || "",
      status: "synced",
      raw_data: txn,
    };
  });

  let savedData = [];
  if (formatted.length > 0) {
    const result = await supabase
      .from("bank_transactions")
      .upsert(formatted, {
        onConflict: "user_id,bank_id,account_id,external_id",
      })
      .select();

    if (result.error) {
      throw new Error(`Failed to sync transactions: ${result.error.message}`);
    }
    savedData = result.data ?? [];
  }

  await supabase
    .from("bank_connections")
    .update({ last_synced: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("bank_id", bankId);

  return savedData;
};

/**
 * Ottiene i movimenti bancari sincronizzati di un utente
 */
export const getUserBankTransactions = async (
  userId,
  bankId = null,
  startDate = null,
  endDate = null
) => {
  let query = supabase
    .from("bank_transactions")
    .select("id, user_id, bank_id, account_id, external_id, amount, currency, description, date, counterparty, status")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (bankId && bankId !== "all") {
    query = query.eq("bank_id", bankId);
  }
  if (startDate) {
    query = query.gte("date", startDate);
  }
  if (endDate) {
    query = query.lte("date", endDate);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
};

/**
 * Assicura che il token della connessione bancaria sia valido
 */
export const ensureValidToken = async (userId, bankId) => {
  const connection = await getBankConnection(userId, bankId);
  if (!connection) return null;

  if (process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY) {
    return await getGoCardlessToken();
  }

  return connection.access_token || "mock_token";
};

/**
 * Disconnette una banca
 */
export const disconnectBankConnection = async (userId, bankId) => {
  const { error } = await supabase
    .from("bank_connections")
    .delete()
    .eq("user_id", userId)
    .eq("bank_id", bankId);

  if (error) throw new Error(`Failed to disconnect bank: ${error.message}`);
};

/**
 * Converte/Importa una o più transazioni bancarie nella tabella Transaction di Flow Wise
 */
export const importBankTransactionsToApp = async (
  userId,
  { transactionIds, walletId, categoryId, defaultType }
) => {
  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    throw new Error("Nessun ID transazione fornito per l'importazione");
  }

  // Verifica esistenza e proprietà del wallet
  const { data: wallet, error: walletError } = await supabase
    .from("Wallet")
    .select("id, name, balance")
    .eq("id", walletId)
    .eq("userid", userId)
    .single();

  if (walletError || !wallet) {
    throw new Error("Wallet di destinazione non trovato o non autorizzato");
  }

  // Verifica esistenza e proprietà della categoria
  const { data: category, error: categoryError } = await supabase
    .from("Category")
    .select("id, name, type")
    .eq("id", categoryId)
    .eq("userid", userId)
    .single();

  if (categoryError || !category) {
    throw new Error("Categoria di destinazione non trovata o non autorizzata");
  }

  // Recupera le transazioni bancarie da importare
  const { data: bankTxns, error: fetchError } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq("user_id", userId)
    .in("id", transactionIds);

  if (fetchError || !bankTxns || bankTxns.length === 0) {
    throw new Error("Nessun movimento bancario corrispondente trovato");
  }

  // Crea i record per la tabella Transaction
  const appTransactions = bankTxns.map((bankTxn) => {
    const rawAmount = Number(bankTxn.amount);
    const type =
      defaultType || (rawAmount >= 0 ? "I" : "E");
    const positiveAmount = Math.abs(rawAmount);

    return {
      userid: userId,
      description: bankTxn.description || bankTxn.counterparty || "Movimento Bancario",
      note: `Importato da banca (${bankTxn.bank_id})`,
      amount: positiveAmount,
      date: new Date(bankTxn.date).toISOString(),
      type,
      wallet_id: Number(walletId),
      category_id: Number(categoryId),
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from("Transaction")
    .insert(appTransactions)
    .select();

  if (insertError) {
    throw new Error(`Impossibile inserire le transazioni: ${insertError.message}`);
  }

  // Aggiorna lo stato dei movimenti bancari a "imported"
  await supabase
    .from("bank_transactions")
    .update({ status: "imported" })
    .eq("user_id", userId)
    .in("id", transactionIds);

  return {
    success: true,
    importedCount: inserted.length,
    transactions: inserted,
  };
};
