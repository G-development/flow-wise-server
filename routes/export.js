import express from "express";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildTransactionsCsv, buildUserExport } from "../utils/exportService.js";

// Export dei dati dell'utente del token (fase 6 C). Le regole stanno in utils/exportService.js:
// tutto filtrato per req.user.id, niente token ne' dati grezzi del fornitore, errore se una lista
// arriva troncata.
const router = express.Router();

const today = () => new Date().toISOString().slice(0, 10);

// GET /export — tutti i dati dell'utente in JSON, come file da scaricare
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = await buildUserExport(req.user);
    res.setHeader("Content-Disposition", `attachment; filename="flow-wise-export-${today()}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.json(payload);
  })
);

// GET /export/transactions.csv — i movimenti come tabella (separatore ;, virgola decimale, BOM)
router.get(
  "/transactions.csv",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { csv } = await buildTransactionsCsv(req.user);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="flow-wise-movements-${today()}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  })
);

export default router;
