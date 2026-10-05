import axios from "axios";
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

// Ottieni configurazione banca
const getBankConfig = (bankId) => {
  return BANK_CONFIGS[bankId] || BANK_CONFIGS.intesa;
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
  expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expiresIn);

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
  const formatted = transactions.map((txn) => ({
    user_id: userId,
    bank_id: bankId,
    account_id: accountId,
    external_id: txn.transactionId || txn.id,
    amount: parseFloat(txn.amount),
    currency: txn.currency || "EUR",
    description: txn.purpose || txn.remittanceInformationUnstructured || "",
    date: txn.bookingDate,
    counterparty: txn.counterparty?.name || "",
    status: "synced",
    raw_data: txn,
  }));

  // Salva nel DB
  const { data, error } = await supabase
    .from("bank_transactions")
    .upsert(formatted, { onConflict: "external_id" });

  if (error) throw new Error(`Failed to sync transactions: ${error.message}`);
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
  if (new Date() > expiresAt) {
    const newToken = await refreshToken(bankId, connection.refresh_token);
    await saveBankConnection(userId, bankId, connection.account_id, newToken);
    return newToken.accessToken;
  }

  return connection.access_token;
};
