import express from "express";
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  fetchAccounts,
  saveBankConnection,
  getBankConnection,
  syncBankTransactions,
  getUserBankTransactions,
  ensureValidToken,
} from "../utils/bankService.js";
import {
  forceBankSync,
  getBankSyncStatus,
} from "../utils/bankSyncScheduler.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

// GET /bank/authorize?bank=intesa&state=xyz
// Genera URL di autorizzazione
router.get(
  "/authorize",
  asyncHandler(async (req, res) => {
    const { bank, state } = req.query;

    if (!bank) {
      return res.status(400).json({ error: "Bank ID required" });
    }

    const authUrl = getAuthorizationUrl(bank, state);
    res.json({ authUrl });
  })
);

// GET /bank/callback?code=xxx&state=yyy
// Callback dalla banca dopo autorizzazione
router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error, bank } = req.query;
    const userId = req.headers["x-user-id"];

    if (error) {
      return res.status(400).json({ error: `Authorization failed: ${error}` });
    }

    if (!code || !bank || !userId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      // Scambia code con token
      const tokenData = await exchangeCodeForToken(bank, code);

      // Ottieni account disponibili
      const accounts = await fetchAccounts(bank, tokenData.accessToken);

      if (!accounts.length) {
        return res.status(400).json({ error: "No accounts found" });
      }

      // Usa il primo account
      const account = accounts[0];

      // Salva connessione
      await saveBankConnection(userId, bank, account.resourceId, tokenData);

      // Sincronizza transazioni
      await syncBankTransactions(
        userId,
        bank,
        account.resourceId,
        tokenData.accessToken
      );

      res.json({
        success: true,
        message: "Bank connected and synced",
        account: {
          id: account.resourceId,
          iban: account.iban,
          name: account.name,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  })
);

// GET /bank/status?bank=intesa
// Verifica stato della connessione
router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const userId = req.headers["x-user-id"];
    const { bank } = req.query;

    if (!userId || !bank) {
      return res.status(400).json({ error: "User ID and bank required" });
    }

    const connection = await getBankConnection(userId, bank);

    res.json({
      connected: !!connection,
      bank,
      account: connection?.account_id,
      lastSynced: connection?.last_synced,
    });
  })
);

// POST /bank/sync?bank=intesa
// Sincronizza transazioni manualmente
router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const userId = req.headers["x-user-id"];
    const { bank } = req.query;

    if (!userId || !bank) {
      return res.status(400).json({ error: "User ID and bank required" });
    }

    const connection = await getBankConnection(userId, bank);

    if (!connection) {
      return res.status(404).json({ error: "Bank not connected" });
    }

    // Verifica e rinfresca token se necessario
    const accessToken = await ensureValidToken(userId, bank);

    if (!accessToken) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const txns = await syncBankTransactions(
        userId,
        bank,
        connection.account_id,
        accessToken
      );

      res.json({
        success: true,
        synced: txns?.length || 0,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  })
);

// GET /bank/transactions?bank=intesa
// Ottieni transazioni sincronizzate
router.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const userId = req.headers["x-user-id"];
    const { bank } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    const txns = await getUserBankTransactions(userId);

    const filtered = bank ? txns.filter((t) => t.bank_id === bank) : txns;

    res.json({
      transactions: filtered,
      count: filtered.length,
    });
  })
);

// POST /bank/disconnect?bank=intesa
// Disconnetti account bancario
router.post(
  "/disconnect",
  asyncHandler(async (req, res) => {
    const userId = req.headers["x-user-id"];
    const { bank } = req.query;

    if (!userId || !bank) {
      return res.status(400).json({ error: "User ID and bank required" });
    }

    // Logica opzionale: cancellare dal DB
    res.json({
      success: true,
      message: "Bank disconnected",
    });
  })
);

// GET /bank/scheduler/status
// Ottieni stato dello scheduler
router.get(
  "/scheduler/status",
  asyncHandler(async (req, res) => {
    const status = getBankSyncStatus();
    res.json(status);
  })
);

// POST /bank/scheduler/sync-now
// Forza sincronizzazione immediata
router.post(
  "/scheduler/sync-now",
  asyncHandler(async (req, res) => {
    await forceBankSync();
    res.json({
      success: true,
      message: "Bank sync triggered manually",
    });
  })
);

export default router;
