import express from "express";
import { timingSafeEqual } from "node:crypto";
import { requireAuth } from "../config/auth-middleware.js";
import {
  createBankOAuthState,
  disconnectBankConnection,
  exchangeCodeForToken,
  fetchAccounts,
  getAuthorizationUrl,
  getBankConnection,
  getBankSetupStatus,
  getSupportedBanks,
  getUserBankTransactions,
  ensureValidToken,
  saveBankConnection,
  syncBankTransactions,
  verifyBankOAuthState,
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

router.get(
  "/config",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getBankSetupStatus());
  })
);

router.get(
  "/institutions",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(getSupportedBanks());
  })
);

router.get(
  "/authorize",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !getSupportedBanks().some((item) => item.id === bank)) {
      return res.status(400).json({ error: "Unsupported or missing bank ID" });
    }

    const setupStatus = await getBankSetupStatus();
    if (!setupStatus.ready) {
      return res.status(503).json({
        error: "Bank integration is not configured",
        issues: setupStatus.issues,
      });
    }

    const state = createBankOAuthState(req.user.id, bank);
    res.json({ authUrl: getAuthorizationUrl(bank, state) });
  })
);

// The bank provider redirects here directly, so the encrypted state carries the
// authenticated user identity instead of relying on a browser auth header.
router.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error, bank } = req.query;
    let oauthState;

    try {
      oauthState = verifyBankOAuthState(state);
    } catch (stateError) {
      return res.status(400).json({ error: stateError.message });
    }

    if (bank && bank !== oauthState.bankId) {
      return res.status(400).json({ error: "OAuth bank does not match state" });
    }

    if (error) {
      return redirectBankResult(res, {
        error_description: "Authorization was declined by the bank.",
      });
    }
    if (typeof code !== "string" || !code) {
      return redirectBankResult(res, {
        error_description: "The bank did not return an authorization code.",
      });
    }

    try {
      const tokenData = await exchangeCodeForToken(oauthState.bankId, code);
      const accounts = await fetchAccounts(
        oauthState.bankId,
        tokenData.accessToken
      );

      if (!accounts.length) {
        return redirectBankResult(res, {
          error_description: "No bank accounts were authorized.",
        });
      }

      const account = accounts[0];
      if (typeof account.resourceId !== "string" || !account.resourceId) {
        throw new Error("Bank provider returned an account without an ID");
      }
      await saveBankConnection(
        oauthState.userId,
        oauthState.bankId,
        account.resourceId,
        tokenData
      );
      let firstSyncFailed = false;
      try {
        await syncBankTransactions(
          oauthState.userId,
          oauthState.bankId,
          account.resourceId,
          tokenData.accessToken
        );
      } catch (syncError) {
        firstSyncFailed = true;
        console.error("Initial bank sync failed:", syncError.message);
      }

      return redirectBankResult(res, {
        connected: "1",
        bank: oauthState.bankId,
        ...(firstSyncFailed ? { sync_error: "1" } : {}),
      });
    } catch (callbackError) {
      console.error("Bank OAuth callback failed:", callbackError.message);
      return redirectBankResult(res, {
        error_description: "The bank connection could not be completed.",
      });
    }
  })
);

router.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !getSupportedBanks().some((item) => item.id === bank)) {
      return res.status(400).json({ error: "Unsupported or missing bank ID" });
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

router.post(
  "/sync",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !getSupportedBanks().some((item) => item.id === bank)) {
      return res.status(400).json({ error: "Unsupported or missing bank ID" });
    }

    const connection = await getBankConnection(req.user.id, bank);
    if (!connection) {
      return res.status(404).json({ error: "Bank not connected" });
    }

    const accessToken = await ensureValidToken(req.user.id, bank);
    if (!accessToken) {
      return res.status(401).json({ error: "Invalid bank access token" });
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

router.get(
  "/transactions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (bank && (typeof bank !== "string" || !getSupportedBanks().some((item) => item.id === bank))) {
      return res.status(400).json({ error: "Unsupported bank ID" });
    }

    const transactions = await getUserBankTransactions(req.user.id);
    const filtered = bank
      ? transactions.filter((transaction) => transaction.bank_id === bank)
      : transactions;
    res.json({ transactions: filtered, count: filtered.length });
  })
);

router.post(
  "/disconnect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { bank } = req.query;
    if (typeof bank !== "string" || !getSupportedBanks().some((item) => item.id === bank)) {
      return res.status(400).json({ error: "Unsupported or missing bank ID" });
    }

    const connection = await getBankConnection(req.user.id, bank);
    if (!connection) {
      return res.status(404).json({ error: "Bank not connected" });
    }
    await disconnectBankConnection(req.user.id, bank);
    res.json({ success: true, message: "Bank disconnected" });
  })
);

router.get(
  "/scheduler/status",
  requireSchedulerSecret,
  asyncHandler(async (_req, res) => {
    res.json(getBankSyncStatus());
  })
);

router.post(
  "/scheduler/sync-now",
  requireSchedulerSecret,
  asyncHandler(async (_req, res) => {
    await forceBankSync();
    res.json({ success: true, message: "Bank sync triggered manually" });
  })
);

export default router;
