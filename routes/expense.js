import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";

const router = express.Router();

// GET /get - restituisce tutte le transazioni
router.get("/all", requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from("TransactionView")
      .select("*")
      .eq("type", "E")
      .eq("userid", req.user.id)
      .order("date", { ascending: false });

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
