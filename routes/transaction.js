import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";

const router = express.Router();

// GET all transactions
router.get("/all", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Transaction")
      .select("*")
      .eq("userid", req.user.id)
      .order("date", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// GET single transaction
router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("Transaction")
      .select("*")
      .eq("id", id)
      .eq("userid", req.user.id)
      .single();

    if (error) return res.status(404).json({ error: error.message });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// POST create transaction
router.post("/", requireAuth, async (req, res) => {
  const { description, note, amount, date, type, wallet_id, category_id } =
    req.body;

  try {
    const { data, error } = await supabase
      .from("Transaction")
      .insert({
        userid: req.user.id,
        description: description,
        note: note,
        amount: amount,
        date: date,
        type: type,
        wallet_id: wallet_id,
        category_id: category_id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// PUT update transaction
router.put("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { description, note, amount, date, type, wallet_id, category_id } =
    req.body;

  try {
    const { data, error } = await supabase
      .from("Transaction")
      .update({
        description,
        note,
        amount,
        date,
        type,
        wallet_id,
        category_id,
      })
      .eq("id", id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// DELETE transaction
router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from("Transaction")
      .delete()
      .eq("id", id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({ message: "Transaction deleted", data });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
