import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

// GET /all - restituisce tutti gli incomi
router.get(
  "/all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from("Transaction")
      .select("*")
      .eq("type", "I")
      .eq("userid", req.user.id)
      .order("date", { ascending: false });

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);

    const { data, error } = await query;

    if (error) {
      console.error("Income query error:", error);
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  })
);

export default router;
