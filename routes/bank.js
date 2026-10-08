import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { requireAuth } from "../config/auth-middleware.js";
import {
  disconnectBankConnection,
  ensureValidToken,
  getAuthorizationUrl,
  getBankConnection,
  getBankSetupStatus,
  getSupportedBanks,
  getUserBankConnections,
  getUserBankTransactions,
  handleGoCardlessCallback,
  importBankTransactionsToApp,
  saveBankConnection,
  syncBankTransactions,
  verifyBankOAuthState,
  POPULAR_BANKS,
} from "../utils/bankService.js";
import {
  forceBankSync,
  getBankSyncStatus,
} from "../utils/bankSyncScheduler.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

const clientRedirectUrl = () =>
  new URL(
    process.env.BANK_CLIENT_REDIRECT_URI ||
      "http://localhost:3000/settings/yourbank"
  );

const redirectBankResult = (res, params) => {
  const redirectUrl = clientRedirectUrl();
  for (const [key, value] of Object.entries(params)) {
    redirectUrl.searchParams.set(key, value);
  }
  return res.redirect(redirectUrl.toString());
};

const requireSchedulerSecret = (req, res, next) => {
  const expected = process.env.BANK_SCHEDULER_SECRET;
  const supplied = req.get("x-scheduler-secret");
  if (!expected) {
    return res.status(503).json({ error: "Scheduler endpoint is not configured" });
  }
  if (typeof supplied !== "string") {
    return res.status(401).json({ error: "Missing scheduler credentials" });
  }

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return res.status(401).json({ error: "Invalid scheduler credentials" });
  }
  next();
};

/**
 * GET /bank/config
 */
router.get(
  "/config",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getBankSetupStatus());
  })
);

/**
 * GET /bank/institutions
 */
router.get(
  "/institutions",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const banks = await getSupportedBanks();
    res.json(banks);
  })
);

/**
 * GET /bank/authorize?bank=<id>
 */
router.get(
  "/authorize",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !bank) {
      return res.status(400).json({ error: "Missing bank parameter" });
    }

    const setupStatus = await getBankSetupStatus();
    if (!setupStatus.ready) {
      return res.status(503).json({
        error: "Bank integration is not configured",
        issues: setupStatus.issues,
      });
    }

    const authUrl = await getAuthorizationUrl(req.user.id, bank);
    res.json({ authUrl });
  })
);

/**
 * GET /bank/mock-auth
 */
router.get(
  "/mock-auth",
  asyncHandler(async (req, res) => {
    const { state, bank } = req.query;
    let bankName = bank || "FlowWise Sandbox Bank";
    try {
      if (!state || typeof state !== "string") {
        throw new Error("Missing state parameter");
      }
      const verified = verifyBankOAuthState(state);
      const found = POPULAR_BANKS.find(
        (b) => b.id === verified.bankId || b.aliases?.includes(verified.bankId)
      );
      if (found) bankName = found.name;
    } catch (err) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="it">
        <head><meta charset="utf-8"><title>Errore Autorizzazione</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f8fafc;}</style>
        </head>
        <body>
          <div style="background:#1e293b;padding:32px;border-radius:16px;max-width:400px;text-align:center;">
            <h2 style="color:#ef4444;margin-top:0;">Autorizzazione non valida</h2>
            <p>${err.message}</p>
            <a href="${clientRedirectUrl().toString()}" style="display:inline-block;margin-top:16px;color:#38bdf8;text-decoration:none;">Torna all'applicazione</a>
          </div>
        </body></html>
      `);
    }

    const mockCode = `mock_code_${randomBytes(16).toString("hex")}`;
    const callbackUrl = `/bank/callback?code=${encodeURIComponent(mockCode)}&state=${encodeURIComponent(state)}&bank=${encodeURIComponent(bank || "")}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Autorizzazione Open Banking Sandbox - ${bankName}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #090d16 0%, #0f172a 100%);
            color: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 16px;
          }
          .card {
            background: rgba(30, 41, 59, 0.85);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 20px;
            padding: 36px 32px;
            max-width: 480px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          }
          .bank-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 16px;
          }
          h1 {
            font-size: 24px;
            margin: 0 0 10px 0;
            font-weight: 700;
            letter-spacing: -0.02em;
          }
          p {
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.5;
            margin: 0 0 24px 0;
          }
          .scope-box {
            background: #0f172a;
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
          }
          .scope-item {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
            color: #e2e8f0;
            margin-bottom: 8px;
          }
          .scope-item:last-child { margin-bottom: 0; }
          .check-icon {
            color: #22c55e;
            font-weight: bold;
          }
          .btn-primary {
            display: block;
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
            color: #ffffff;
            border: none;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 600;
            text-align: center;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .btn-primary:hover {
            opacity: 0.95;
            transform: translateY(-1px);
          }
          .btn-cancel {
            display: block;
            width: 100%;
            margin-top: 12px;
            padding: 12px;
            background: transparent;
            color: #64748b;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            font-size: 14px;
            text-align: center;
            text-decoration: none;
          }
          .btn-cancel:hover {
            color: #94a3b8;
            background: rgba(255, 255, 255, 0.02);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="bank-badge">
            <span>🏛️</span> ${bankName}
          </div>
          <h1>Autorizza Connessione</h1>
          <p>Flow Wise richiede l'autorizzazione di sola lettura (PSD2 AISP) per consultare i tuoi conti e sincronizzare i movimenti finanziari.</p>

          <div class="scope-box">
            <div class="scope-item">
              <span class="check-icon">✓</span>
              <span>Visualizzazione saldo e coordinate conto</span>
            </div>
            <div class="scope-item">
              <span class="check-icon">✓</span>
              <span>Lettura dello storico transazioni (ultimi 90 giorni)</span>
            </div>
            <div class="scope-item">
              <span class="check-icon">✓</span>
              <span>Sincronizzazione automatica periodica</span>
            </div>
          </div>

          <a href="${callbackUrl}" class="btn-primary">
            Conferma e Autorizza Accesso
          </a>
          <a href="${clientRedirectUrl().toString()}" class="btn-cancel">
            Annulla
          </a>
        </div>
      </body>
      </html>
    `);
  })
);

/**
 * GET /bank/callback
 * Gestione callback da GoCardless o Mock
 */
router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error, ref } = req.query;
    let oauthState;

    try {
      oauthState = verifyBankOAuthState(state || ref);
    } catch (stateError) {
      console.error("State verification error in callback:", stateError.message);
      return redirectBankResult(res, {
        error_description: "Autorizzazione non valida o sessione scaduta.",
      });
    }

    if (error) {
      return redirectBankResult(res, {
        error_description: "Autorizzazione rifiutata dalla banca.",
      });
    }

    try {
      // Se è un flusso GoCardless con requisitionId
      if (oauthState.requisitionId) {
        await handleGoCardlessCallback(
          oauthState.userId,
          oauthState.bankId,
          oauthState.requisitionId
        );
      } else {
        // Flusso Sandbox Mock
        const mockAccountId = `acc_${oauthState.bankId}_${randomBytes(4).toString("hex")}`;
        await saveBankConnection(
          oauthState.userId,
          oauthState.bankId,
          mockAccountId,
          {
            accessToken: "mock_token",
            expiresIn: 7776000,
          }
        );

        // Primo sync
        await syncBankTransactions(
          oauthState.userId,
          oauthState.bankId,
          mockAccountId,
          "mock_token"
        );
      }

      return redirectBankResult(res, {
        connected: "1",
        bank: oauthState.bankId,
      });
    } catch (callbackError) {
      console.error("Bank OAuth callback error:", callbackError.message);
      return redirectBankResult(res, {
        error_description: callbackError.message || "Impossibile completare la connessione con la banca.",
      });
    }
  })
);

/**
 * GET /bank/connections
 */
router.get(
  "/connections",
  requireAuth,
  asyncHandler(async (req, res) => {
    const connections = await getUserBankConnections(req.user.id);
    res.json({
      connections: connections.map((conn) => ({
        bank: conn.bank_id,
        account: conn.account_id,
        lastSynced: conn.last_synced,
      })),
    });
  })
);

/**
 * GET /bank/status?bank=<id>
 */
router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !bank) {
      return res.status(400).json({ error: "Missing bank ID" });
    }

    const connection = await getBankConnection(req.user.id, bank);
    res.json({
      connected: !!connection,
      bank,
      account: connection?.account_id ?? null,
      lastSynced: connection?.last_synced ?? null,
    });
  })
);

/**
 * POST /bank/sync?bank=<id>
 */
router.post(
  "/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !bank) {
      return res.status(400).json({ error: "Missing bank ID" });
    }

    const connection = await getBankConnection(req.user.id, bank);
    if (!connection) {
      return res.status(404).json({ error: "Banca non connessa" });
    }

    const accessToken = await ensureValidToken(req.user.id, bank);
    if (!accessToken) {
      return res.status(401).json({ error: "Token di accesso non valido o scaduto" });
    }

    const transactions = await syncBankTransactions(
      req.user.id,
      bank,
      connection.account_id,
      accessToken
    );
    res.json({ success: true, synced: transactions.length });
  })
);

/**
 * GET /bank/transactions?bank=<id>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>
 */
router.get(
  "/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank, startDate, endDate } = req.query;

    const transactions = await getUserBankTransactions(
      req.user.id,
      bank || null,
      startDate || null,
      endDate || null
    );
    res.json({ transactions, count: transactions.length });
  })
);

/**
 * POST /bank/import
 */
router.post(
  "/import",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { transactionIds, walletId, categoryId, defaultType } = req.body;

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: "Nessuna transazione selezionata per l'importazione" });
    }
    if (!walletId) {
      return res.status(400).json({ error: "Wallet di destinazione obbligatorio" });
    }
    if (!categoryId) {
      return res.status(400).json({ error: "Categoria di destinazione obbligatoria" });
    }

    const result = await importBankTransactionsToApp(req.user.id, {
      transactionIds,
      walletId,
      categoryId,
      defaultType,
    });

    res.status(201).json(result);
  })
);

/**
 * POST /bank/disconnect?bank=<id>
 */
router.post(
  "/disconnect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !bank) {
      return res.status(400).json({ error: "Missing bank ID" });
    }

    const connection = await getBankConnection(req.user.id, bank);
    if (!connection) {
      return res.status(404).json({ error: "Banca non connessa" });
    }
    await disconnectBankConnection(req.user.id, bank);
    res.json({ success: true, message: "Banca disconnessa con successo" });
  })
);

/**
 * GET /bank/scheduler/status
 */
router.get(
  "/scheduler/status",
  requireSchedulerSecret,
  asyncHandler(async (_req, res) => {
    res.json(getBankSyncStatus());
  })
);

/**
 * POST /bank/scheduler/sync-now
 */
router.post(
  "/scheduler/sync-now",
  requireSchedulerSecret,
  asyncHandler(async (_req, res) => {
    await forceBankSync();
    res.json({ success: true, message: "Sincronizzazione globale avviata manualmente" });
  })
);

export default router;
