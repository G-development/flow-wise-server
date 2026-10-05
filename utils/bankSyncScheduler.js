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
 * Sincronizza transazioni per un utente
 */
const syncUserBankTransactions = async (userId, bankId) => {
  try {
    const connection = await getBankConnection(userId, bankId);

    if (!connection) {
      console.log(`No bank connection for user ${userId}, bank ${bankId}`);
      return;
    }

    // Verifica e rinfresca token se necessario
    const accessToken = await ensureValidToken(userId, bankId);

    if (!accessToken) {
      console.warn(`Failed to get valid token for user ${userId}, bank ${bankId}`);
      return;
    }

    // Sincronizza
    const synced = await syncBankTransactions(
      userId,
      bankId,
      connection.account_id,
      accessToken
    );

    console.log(
      `✓ Synced ${synced?.length || 0} transactions for user ${userId} from ${bankId}`
    );
  } catch (error) {
    console.error(
      `Error syncing transactions for user ${userId}, bank ${bankId}:`,
      error.message
    );
  }
};

/**
 * Ottieni tutti gli utenti con connessioni bancarie
 */
const getAllBankConnections = async () => {
  try {
    const { data, error } = await supabase
      .from("bank_connections")
      .select("user_id, bank_id")
      .not("user_id", "is", null);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching bank connections:", error.message);
    return [];
  }
};

/**
 * Sincronizza tutte le transazioni per tutti gli utenti
 */
const syncAllUserTransactions = async () => {
  console.log(`\n🔄 Starting bank transaction sync at ${new Date().toISOString()}`);

  const connections = await getAllBankConnections();

  if (connections.length === 0) {
    console.log("No bank connections to sync");
    return;
  }

  console.log(`Found ${connections.length} bank connection(s) to sync`);

  // Sincronizza in parallelo con limite di concorrenza
  const batchSize = 5;
  for (let i = 0; i < connections.length; i += batchSize) {
    const batch = connections.slice(i, i + batchSize);
    await Promise.all(
      batch.map(({ user_id, bank_id }) =>
        syncUserBankTransactions(user_id, bank_id)
      )
    );
  }

  console.log(`✓ Bank transaction sync completed at ${new Date().toISOString()}\n`);
};

/**
 * Avvia lo scheduler con pattern cron configurabile
 */
export const startBankSyncScheduler = () => {
  const cronPattern = process.env.BANK_SYNC_CRON || "0 * * * *";

  console.log(`\n📅 Bank sync scheduler starting with pattern: ${cronPattern}`);

  const task = cron.schedule(cronPattern, syncAllUserTransactions);

  scheduledTasks.set("bankSync", task);

  console.log("✓ Bank sync scheduler is running\n");
};

/**
 * Ferma lo scheduler
 */
export const stopBankSyncScheduler = () => {
  const task = scheduledTasks.get("bankSync");
  if (task) {
    task.stop();
    scheduledTasks.delete("bankSync");
    console.log("✓ Bank sync scheduler stopped");
  }
};

/**
 * Forza una sincronizzazione immediata
 */
export const forceBankSync = () => {
  console.log("⚡ Forcing immediate bank sync...");
  return syncAllUserTransactions();
};

/**
 * Ottieni stato dello scheduler
 */
export const getBankSyncStatus = () => {
  const task = scheduledTasks.get("bankSync");
  return {
    running: !!task,
    pattern: process.env.BANK_SYNC_CRON || "0 * * * *",
    lastRun: "Check logs for details",
  };
};
