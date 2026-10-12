import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { transactionCreateSchema, transactionUpdateSchema } from "../utils/schemas.js";
import { fetchAllRows, toListResponse } from "../utils/paginatedSelect.js";

const router = express.Router();

// GET all transactions
router.get(
  "/all",
  requireAuth,
  asyncHandler(async (req, res) => {
    let result;
    try {
      result = await fetchAllRows(() =>
        supabase
          .from("Transaction")
          .select("*", { count: "exact" })
          .eq("userid", req.user.id)
          .order("date", { ascending: false })
          // Tiebreaker univoco: senza di esso le pagine possono ripetersi o saltare righe.
          .order("id", { ascending: false })
      );
    } catch (err) {
      // Stesso esito di prima dell'helper (che lancia sul primo errore PostgREST).
      return res.status(400).json({ error: err.message });
    }

    res.status(200).json(toListResponse(result));
  })
);

// GET single transaction
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("Transaction")
      .select("*")
      .eq("id", id)
      .eq("userid", req.user.id)
      .single();

    if (error) return res.status(404).json({ error: error.message });
    res.status(200).json(data);
  })
);

// POST create transaction
router.post(
  "/",
  requireAuth,
  validate(transactionCreateSchema),
  asyncHandler(async (req, res) => {
    const { description, note, amount, date, type, wallet_id, category_id } =
      req.body;

    const { data, error } = await supabase
      .from("Transaction")
      .insert({
        userid: req.user.id,
        description,
        note,
        amount,
        date,
        type,
        wallet_id,
        category_id,
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

// PUT update transaction
router.put(
  "/:id",
  requireAuth,
  validate(transactionUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { description, note, amount, date, type, wallet_id, category_id } =
      req.body;

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
  })
);

// DELETE transaction
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("Transaction")
      .delete()
      .eq("id", id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({ message: "Transaction deleted", data });
  })
);

export default router;
