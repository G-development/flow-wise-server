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

// Configurazione per diverse banche italiane
const BANK_CONFIGS = {
  intesa: {
    name: "Intesa San Paolo",
    authUrl: "https://api.sandbox.intesasanpaolo.com/oauth/authorize",
    tokenUrl: "https://api.sandbox.intesasanpaolo.com/oauth/token",
    apiUrl: "https://api.sandbox.intesasanpaolo.com/api/v1",
    scope: "accounts transactions",
  },
  unicredit: {
    name: "UniCredit",
    authUrl: "https://sandbox.unicredit.eu/oauth/authorize",
    tokenUrl: "https://sandbox.unicredit.eu/oauth/token",
    apiUrl: "https://sandbox.unicredit.eu/api/v1",
    scope: "accounts transactions",
  },
  bnl: {
    name: "BNL",
    authUrl: "https://api.sandbox.bnl.it/oauth/authorize",
    tokenUrl: "https://api.sandbox.bnl.it/oauth/token",
    apiUrl: "https://api.sandbox.bnl.it/api/v1",
    scope: "accounts transactions",
  },
};

const REQUIRED_BANK_ENV = [
  "BANK_CLIENT_ID",
  "BANK_CLIENT_SECRET",
  "BANK_REDIRECT_URI",
  "BANK_CLIENT_REDIRECT_URI",
];

export const getBankSetupStatus = async () => {
  const issues = [];
  const missingEnv = REQUIRED_BANK_ENV.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    issues.push({
      code: "provider_not_configured",
      message: `Configurazione bancaria incompleta sul server: ${missingEnv.join(", ")}.`,
    });
  }

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
          ? `Tabella ${table} non presente: applica le migrazioni bancarie nel progetto Supabase.`
          : `Impossibile verificare la tabella ${table} nel database.`,
      });
    }
  }

  return { ready: issues.length === 0, issues };
};

// Ottieni configurazione banca
const getBankConfig = (bankId) => {
  const bank = BANK_CONFIGS[bankId];
  if (!bank) throw new Error("Unsupported bank");
  return bank;
};

export const getSupportedBanks = () =>
  Object.entries(BANK_CONFIGS).map(([id, bank]) => ({ id, name: bank.name }));

export const createBankOAuthState = (userId, bankId) => {
  if (!process.env.BANK_CLIENT_SECRET) {
    throw new Error("BANK_CLIENT_SECRET is not configured");
  }

  const key = createHash("sha256")
    .update(process.env.BANK_CLIENT_SECRET)
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      bankId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    })
  );
  const encrypted = Buffer.concat([
    cipher.update(payload),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
};

export const verifyBankOAuthState = (state) => {
  if (typeof state !== "string" || !process.env.BANK_CLIENT_SECRET) {
    throw new Error("Invalid OAuth state");
  }

  const [encodedIv, encodedPayload, encodedTag, extra] = state.split(".");
  if (!encodedIv || !encodedPayload || !encodedTag || extra !== undefined) {
    throw new Error("Invalid OAuth state");
  }

  let payload;
  try {
    const iv = Buffer.from(encodedIv, "base64url");
    const encrypted = Buffer.from(encodedPayload, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) {
      throw new Error("Invalid OAuth state");
    }
    const key = createHash("sha256")
      .update(process.env.BANK_CLIENT_SECRET)
      .digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    payload = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Invalid OAuth state");
  }

  let stateData;
  try {
    stateData = JSON.parse(payload);
  } catch {
    throw new Error("Invalid OAuth state");
  }

  if (
    typeof stateData.userId !== "string" ||
    typeof stateData.bankId !== "string" ||
    typeof stateData.expiresAt !== "number" ||
    stateData.expiresAt < Date.now()
  ) {
    throw new Error("Expired or invalid OAuth state");
  }
  getBankConfig(stateData.bankId);
  return stateData;
};

// Genera URL di autorizzazione
export const getAuthorizationUrl = (bankId, state) => {
  const bank = getBankConfig(bankId);
  const redirectUri = process.env.BANK_REDIRECT_URI || "http://localhost:5030/bank/callback";
  
  const params = new URLSearchParams({
    client_id: process.env.BANK_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: bank.scope,
    response_type: "code",
    state: state || "",
  });

  return `${bank.authUrl}?${params.toString()}`;
};

// Scambia authorization code con token
export const exchangeCodeForToken = async (bankId, code) => {
  const bank = getBankConfig(bankId);
  const redirectUri = process.env.BANK_REDIRECT_URI || "http://localhost:5030/bank/callback";

  try {
    const response = await axios.post(
      bank.tokenUrl,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.BANK_CLIENT_ID,
        client_secret: process.env.BANK_CLIENT_SECRET,
      },
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    throw new Error(`Failed to exchange code: ${error.message}`);
  }
};

// Rinfresca token
export const refreshToken = async (bankId, refreshToken) => {
  const bank = getBankConfig(bankId);

  try {
    const response = await axios.post(
      bank.tokenUrl,
      {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.BANK_CLIENT_ID,
        client_secret: process.env.BANK_CLIENT_SECRET,
      },
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    throw new Error(`Failed to refresh token: ${error.message}`);
  }
};

// Ottieni account dell'utente
export const fetchAccounts = async (bankId, accessToken) => {
  const bank = getBankConfig(bankId);

  try {
    const response = await axios.get(`${bank.apiUrl}/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return response.data.accounts || [];
  } catch (error) {
    throw new Error(`Failed to fetch accounts: ${error.message}`);
  }
};

// Ottieni transazioni di un account
export const fetchTransactions = async (bankId, accessToken, accountId, fromDate, toDate) => {
  const bank = getBankConfig(bankId);

  try {
    const params = new URLSearchParams();
    if (fromDate) params.append("dateFrom", fromDate);
    if (toDate) params.append("dateTo", toDate);

    const response = await axios.get(
      `${bank.apiUrl}/accounts/${accountId}/transactions?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    return response.data.transactions || [];
  } catch (error) {
    throw new Error(`Failed to fetch transactions: ${error.message}`);
  }
};

// Salva connessione bancaria nel DB
export const saveBankConnection = async (userId, bankId, accountId, tokenData) => {
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + Number(tokenData.expiresIn || 3600));

  const { error } = await supabase.from("bank_connections").upsert({
    user_id: userId,
    bank_id: bankId,
    account_id: accountId,
    access_token: tokenData.accessToken,
    refresh_token: tokenData.refreshToken,
    token_expires_at: expiresAt.toISOString(),
    last_synced: new Date().toISOString(),
  });

  if (error) throw new Error(`Failed to save connection: ${error.message}`);
};

// Ottieni connessione bancaria
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

// Sincronizza transazioni
export const syncBankTransactions = async (userId, bankId, accountId, accessToken) => {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);

  const dateFrom = fromDate.toISOString().split("T")[0];
  const dateTo = toDate.toISOString().split("T")[0];

  const transactions = await fetchTransactions(bankId, accessToken, accountId, dateFrom, dateTo);

  // Formatta transazioni
  const formatted = transactions.map((txn) => {
    const externalIdValue = txn.transactionId ?? txn.id;
    const externalId =
      externalIdValue === undefined || externalIdValue === null
        ? ""
        : String(externalIdValue);
    const amount = Number(txn.amount ?? txn.transactionAmount?.amount);
    const date = txn.bookingDate || txn.date;
    if (
      !externalId ||
      !Number.isFinite(amount) ||
      typeof date !== "string" ||
      Number.isNaN(Date.parse(date))
    ) {
      throw new Error("Bank provider returned a transaction with invalid required fields");
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
      counterparty: txn.counterparty?.name || "",
      status: "synced",
      raw_data: txn,
    };
  });

  // Salva nel DB
  let data = [];
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
    data = result.data ?? [];
  }

  const { error: timestampError } = await supabase
    .from("bank_connections")
    .update({ last_synced: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("bank_id", bankId);
  if (timestampError) {
    throw new Error(`Failed to update last bank sync time: ${timestampError.message}`);
  }
  return data;
};

// Ottieni transazioni sincronizzate
export const getUserBankTransactions = async (userId) => {
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};

// Verifica e rinfresca token se necessario
export const ensureValidToken = async (userId, bankId) => {
  const connection = await getBankConnection(userId, bankId);
  if (!connection) return null;

  const expiresAt = new Date(connection.token_expires_at);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    Date.now() >= expiresAt.getTime()
  ) {
    const newToken = await refreshToken(bankId, connection.refresh_token);
    await saveBankConnection(userId, bankId, connection.account_id, {
      ...newToken,
      refreshToken: newToken.refreshToken || connection.refresh_token,
    });
    return newToken.accessToken;
  }

  return connection.access_token;
};

export const disconnectBankConnection = async (userId, bankId) => {
  const { error } = await supabase
    .from("bank_connections")
    .delete()
    .eq("user_id", userId)
    .eq("bank_id", bankId);
  if (error) throw new Error(`Failed to disconnect bank: ${error.message}`);
};
