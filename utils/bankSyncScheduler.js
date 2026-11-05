import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import {
  ensureValidToken,
  syncBankTransactions,
  getBankConnection,
} from "./bankService.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let scheduledTasks = new Map();

/**
 * Sincronizza i movimenti di una connessione.
 * Restituisce un esito con soli conteggi: finisce nella risposta di
 * POST /bank/scheduler/sync-now, letta dai log pubblici di GitHub Actions.
 */
const syncUserBankTransactions = async (userId, bankId) => {
  try {
    const connection = await getBankConnection(userId, bankId);
    if (!connection) {
      return { bank: bankId, synced: 0, error: "Connessione non trovata" };
    }

    const accessToken = await ensureValidToken(userId, bankId);
    if (!accessToken) {
      return { bank: bankId, synced: 0, error: "Token di accesso non disponibile" };
    }

    const synced = await syncBankTransactions(
      userId,
      bankId,
      connection.account_id,
      accessToken
    );
    return { bank: bankId, synced: synced?.length || 0, error: null };
  } catch (error) {
    console.error(`Error syncing transactions for user ${userId}, bank ${bankId}:`, error.message);
    return { bank: bankId, synced: 0, error: error.message };
  }
};

const getAllBankConnections = async () => {
  const { data, error } = await supabase
    .from("bank_connections")
    .select("user_id, bank_id")
    .not("user_id", "is", null);
  if (error) {
    throw new Error(`Lettura connessioni bancarie fallita: ${error.message}`);
  }
  return data || [];
};

/**
 * Sincronizza tutte le connessioni bancarie.
 * @returns {{ connections: number, synced: number, results: Array<{bank, synced, error}> }}
 */
const syncAllUserTransactions = async () => {
  const connections = await getAllBankConnections();
  const results = [];

  // Sincronizza in parallelo con limite di concorrenza
  const batchSize = 5;
  for (let i = 0; i < connections.length; i += batchSize) {
    const batch = connections.slice(i, i + batchSize);
    results.push(
      ...(await Promise.all(
        batch.map(({ user_id, bank_id }) => syncUserBankTransactions(user_id, bank_id))
      ))
    );
  }

  return {
    connections: connections.length,
    synced: results.reduce((sum, result) => sum + result.synced, 0),
    results,
  };
};

/**
 * Scheduler in-process, solo su richiesta esplicita (`BANK_SYNC_CRON`).
 *
 * Il job ufficiale e' il workflow giornaliero di GitHub Actions
 * (`.github/workflows/bank-auto-import.yml`). Prima questo cron partiva sempre, ogni ora,
 * anche in sviluppo locale: oltre a non funzionare su Vercel (funzioni serverless, nessun
 * processo che resta vivo), consumava le letture che le banche concedono senza utente
 * presente (PSD2: spesso 4 al giorno per conto).
 */
export const startBankSyncScheduler = () => {
  const cronPattern = process.env.BANK_SYNC_CRON;
  if (!cronPattern || process.env.VERCEL) return false;

  const task = cron.schedule(cronPattern, () =>
    syncAllUserTransactions().catch((error) =>
      console.error("Bank sync scheduler run failed:", error.message)
    )
  );
  scheduledTasks.set("bankSync", task);
  console.log(`📅 Bank sync scheduler running with pattern: ${cronPattern}`);
  return true;
};

export const stopBankSyncScheduler = () => {
  const task = scheduledTasks.get("bankSync");
  if (task) {
    task.stop();
    scheduledTasks.delete("bankSync");
  }
};

/** Sincronizzazione immediata di tutte le connessioni (POST /bank/scheduler/sync-now). */
export const forceBankSync = () => syncAllUserTransactions();

export const getBankSyncStatus = () => ({
  inProcessScheduler: scheduledTasks.has("bankSync"),
  pattern: process.env.BANK_SYNC_CRON || null,
  externalJob: "GitHub Actions: .github/workflows/bank-auto-import.yml",
});
