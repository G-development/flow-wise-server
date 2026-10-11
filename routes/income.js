import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { fetchAllRows, toListResponse } from "../utils/paginatedSelect.js";

const router = express.Router();

// GET /all - restituisce tutti gli incassi
// Legge a pagine: la select una-shot si fermava al tetto PostgREST di 1000 righe
// senza dirlo. Il payload dichiara ora `truncated` (e `total` quando il DB lo
// fornisce) secondo il contratto di utils/paginatedSelect.js.
router.get(
  "/all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    // Factory, non query già costruita: fetchAllRows applica `.range()` a ogni pagina.
    const buildQuery = () => {
      let query = supabase
        .from("Transaction")
        .select("*", { count: "exact" })
        .eq("type", "I")
        .eq("userid", req.user.id)
        .order("date", { ascending: false })
        // Tiebreaker: `date` non è univoco, senza un secondo criterio Postgres può
        // cambiare l'ordine tra le pagine e duplicare/saltare righe.
        .order("id", { ascending: false });

      if (startDate) query = query.gte("date", startDate);
      if (endDate) query = query.lte("date", endDate);

      return query;
    };

    try {
      const result = await fetchAllRows(buildQuery);
      res.status(200).json(toListResponse(result));
    } catch (err) {
      console.error("Income query error:", err);
      res.status(400).json({ error: err.message });
    }
  })
);

export default router;
