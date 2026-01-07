import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

// GET /wallet - tutti i wallet dell'utente
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("Wallet")
      .select("*")
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json(data);
  })
);

// POST /wallet - crea un nuovo wallet
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Missing wallet name" });

    // Controlla quanti wallet ha già l'utente
    const { data: existingWallets, error: countError } = await supabase
      .from("Wallet")
      .select("id", { count: "exact" })
      .eq("userid", req.user.id);

    if (countError) return res.status(400).json({ error: countError.message });
    if (existingWallets.length >= 3)
      return res.status(400).json({ error: "Max 3 wallets allowed per user" });

    // Se è il primo wallet, lo settiamo come default
    const isDefault = existingWallets.length === 0;

    const { data, error } = await supabase.from("Wallet").insert([
      {
        name,
        userid: req.user.id,
        is_default: isDefault,
        balance: 0,
      },
    ]);

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data[0]);
  })
);

// PUT /wallets/:id - aggiorna nome o saldo
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, balance, is_default } = req.body;
    const { id } = req.params;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (balance !== undefined) updates.balance = balance;
    if (is_default !== undefined) updates.is_default = is_default;

    // Se si imposta is_default, resetta gli altri wallet a false
    if (is_default) {
      await supabase
        .from("Wallet")
        .update({ is_default: false })
        .eq("userid", req.user.id);
    }

    const { data, error } = await supabase
      .from("Wallet")
      .update(updates)
      .eq("id", id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json(data);
  })
);

// DELETE /wallet/:id - elimina un wallet
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("Wallet")
      .delete()
      .eq("id", id)
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.status(200).json({ message: "Wallet deleted", wallet: data[0] });
  })
);

export default router;
