import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { getWalletsWithBalances } from "../utils/walletService.js";
import { computeAnnualPlan, shiftOneYear } from "../utils/annualPlan.js";
import {
  annualItemCreateSchema,
  annualItemUpdateSchema,
  annualInstallmentSchema,
  annualInstallmentUpdateSchema,
  annualPaymentSchema,
} from "../utils/schemas.js";

/**
 * Piano delle spese annuali (fase 3, TODO_SALVADANAI.md; tabelle della migrazione 013).
 *
 * Una voce (`annual_items`) ha rate esplicite (`annual_installments`) ed e' pagata da un
 * salvadanaio. `GET /annual-plan?walletId=` restituisce voci, rate e il calcolo del piano di quel
 * salvadanaio (utils/annualPlan.js). Come ogni route del server, ogni query filtra per l'utente
 * del token: le tabelle hanno RLS senza policy e le legge solo il server.
 */
const router = express.Router();

const today = () => new Date().toISOString().slice(0, 10);

/** Il salvadanaio dell'utente, o null. Un conto non puo' pagare voci del piano. */
const findPot = async (userId, walletId) => {
  const { data, error } = await supabase
    .from("Wallet")
    .select("id, kind")
    .eq("id", walletId)
    .eq("userid", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data && data.kind === "pot" ? data : null;
};

const findItem = async (userId, itemId) => {
  const { data, error } = await supabase
    .from("annual_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
};

/**
 * Voci dell'utente con le loro rate ordinate per data. `paid` = segnata pagata a mano
 * (`is_paid`, migrazione 015) oppure collegata alla transazione che l'ha pagata.
 */
const loadItems = async (userId) => {
  const [items, installments] = await Promise.all([
    supabase.from("annual_items").select("*").eq("user_id", userId).order("id"),
    supabase.from("annual_installments").select("*").eq("user_id", userId).order("due_date").order("id"),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (installments.error) throw new Error(installments.error.message);
  return (items.data ?? []).map((item) => ({
    ...item,
    installments: (installments.data ?? [])
      .filter((row) => String(row.item_id) === String(item.id))
      .map((row) => ({ ...row, paid: row.is_paid === true || row.transaction_id != null })),
  }));
};

// GET /annual-plan?walletId=  — voci, rate e calcolo del piano di un salvadanaio
router.get(
  "/annual-plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const walletId = Number(req.query.walletId);
    if (!Number.isInteger(walletId)) return res.status(400).json({ error: "walletId is required" });

    const wallets = await getWalletsWithBalances(req.user.id);
    const pot = wallets.find((wallet) => Number(wallet.id) === walletId);
    if (!pot || pot.kind !== "pot") return res.status(404).json({ error: "Savings pot not found" });

    const items = (await loadItems(req.user.id)).filter(
      (item) => Number(item.pot_wallet_id) === walletId && item.active
    );
    const plan = computeAnnualPlan({
      balanceCents: Math.round(Number(pot.balance) * 100),
      installments: items.flatMap((item) => item.installments),
      today: today(),
      capCents: pot.cap_cents ?? null,
      capFromPlan: pot.cap_from_plan === true,
    });

    res.status(200).json({ wallet: { id: pot.id, name: pot.name }, today: today(), plan, items });
  })
);

// GET /annual-items — tutte le voci dell'utente, con le rate
router.get(
  "/annual-items",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await loadItems(req.user.id));
  })
);

// POST /annual-items — nuova voce, con le sue rate (facoltative)
router.post(
  "/annual-items",
  requireAuth,
  validate(annualItemCreateSchema),
  asyncHandler(async (req, res) => {
    const { name, pot_wallet_id, note = null, installments = [] } = req.body;
    if (!(await findPot(req.user.id, pot_wallet_id))) {
      return res.status(400).json({ error: "pot_wallet_id must be one of your savings pots" });
    }

    const { data: item, error } = await supabase
      .from("annual_items")
      .insert({ user_id: req.user.id, name, pot_wallet_id, note })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });

    if (installments.length > 0) {
      const { error: rowsError } = await supabase
        .from("annual_installments")
        .insert(installments.map((row) => ({ ...row, item_id: item.id, user_id: req.user.id })))
        .select("id");
      if (rowsError) return res.status(400).json({ error: rowsError.message });
    }

    const items = await loadItems(req.user.id);
    res.status(201).json(items.find((row) => String(row.id) === String(item.id)));
  })
);

// PUT /annual-items/:id — nome, nota, attiva, salvadanaio
router.put(
  "/annual-items/:id",
  requireAuth,
  validate(annualItemUpdateSchema),
  asyncHandler(async (req, res) => {
    const { name, note, active, pot_wallet_id } = req.body;
    if (pot_wallet_id !== undefined && !(await findPot(req.user.id, pot_wallet_id))) {
      return res.status(400).json({ error: "pot_wallet_id must be one of your savings pots" });
    }
    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (note !== undefined) updates.note = note;
    if (active !== undefined) updates.active = active;
    if (pot_wallet_id !== undefined) updates.pot_wallet_id = pot_wallet_id;

    const { data, error } = await supabase
      .from("annual_items")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Item not found" });
    res.status(200).json({ id: data.id });
  })
);

// DELETE /annual-items/:id — la voce e le sue rate (ON DELETE CASCADE)
router.delete(
  "/annual-items/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("annual_items")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id");
    if (error) return res.status(400).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: "Item not found" });
    res.status(200).json({ message: "Item deleted" });
  })
);

// POST /annual-items/:id/installments — una rata in piu'
router.post(
  "/annual-items/:id/installments",
  requireAuth,
  validate(annualInstallmentSchema),
  asyncHandler(async (req, res) => {
    if (!(await findItem(req.user.id, req.params.id))) return res.status(404).json({ error: "Item not found" });
    const { data, error } = await supabase
      .from("annual_installments")
      .insert({ ...req.body, item_id: Number(req.params.id), user_id: req.user.id })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

/**
 * POST /annual-items/:id/copy-next-year — ripete l'ultimo anno della voce: le rate degli ultimi
 * 12 mesi (fino all'ultima rata) vengono copiate un anno avanti, stesso giorno e importo, da
 * correggere poi a mano. "Anno" e' una finestra di 12 mesi e non l'anno solare: una voce come
 * l'AdE (luglio…maggio) o l'universita' attraversa due anni solari. Le date gia' presenti non
 * vengono duplicate.
 */
router.post(
  "/annual-items/:id/copy-next-year",
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = (await loadItems(req.user.id)).find((row) => String(row.id) === String(req.params.id));
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.installments.length === 0) return res.status(400).json({ error: "The item has no installments to copy" });

    const dates = item.installments.map((row) => String(row.due_date).slice(0, 10)).sort();
    const last = dates[dates.length - 1];
    const windowStart = shiftOneYear(last).replace(/^\d{4}/, (year) => String(Number(year) - 2));
    const existing = new Set(dates);
    const copies = item.installments
      .filter((row) => String(row.due_date).slice(0, 10) > windowStart)
      .map((row) => ({ due_date: shiftOneYear(row.due_date), amount_cents: row.amount_cents }))
      .filter((row) => !existing.has(row.due_date))
      .map((row) => ({ ...row, item_id: item.id, user_id: req.user.id }));

    if (copies.length > 0) {
      const { error } = await supabase.from("annual_installments").insert(copies).select("id");
      if (error) return res.status(400).json({ error: error.message });
    }
    res.status(201).json({ copied: copies.length, until: shiftOneYear(last) });
  })
);

// PUT /annual-installments/:id — data, importo previsto o `is_paid` (pagata a mano, 015)
router.put(
  "/annual-installments/:id",
  requireAuth,
  validate(annualInstallmentUpdateSchema),
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("annual_installments")
      .update(req.body)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Installment not found" });
    res.status(200).json({ ...data, paid: data.is_paid === true || data.transaction_id != null });
  })
);

// DELETE /annual-installments/:id
router.delete(
  "/annual-installments/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("annual_installments")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id");
    if (error) return res.status(400).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: "Installment not found" });
    res.status(200).json({ message: "Installment deleted" });
  })
);

// PUT /annual-installments/:id/payment — collega (o scollega, con null) la transazione che l'ha pagata
router.put(
  "/annual-installments/:id/payment",
  requireAuth,
  validate(annualPaymentSchema),
  asyncHandler(async (req, res) => {
    const { transaction_id } = req.body;
    if (transaction_id != null) {
      const { data: transaction, error } = await supabase
        .from("Transaction")
        .select("id")
        .eq("id", transaction_id)
        .eq("userid", req.user.id)
        .maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      if (!transaction) return res.status(400).json({ error: "transaction_id must be one of your transactions" });
    }

    const { data, error } = await supabase
      .from("annual_installments")
      .update({ transaction_id })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Installment not found" });
    res.status(200).json({ ...data, paid: data.is_paid === true || data.transaction_id != null });
  })
);

export default router;
