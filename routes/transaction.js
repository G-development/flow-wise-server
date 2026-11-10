import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { transactionCreateSchema, transactionUpdateSchema } from "../utils/schemas.js";
import { fetchAllRows, toListResponse } from "../utils/paginatedSelect.js";
import { learnRuleFromCorrection } from "../utils/categoryRules.js";

const router = express.Router();

/**
 * Controlli sui riferimenti di una transazione che lo schema Zod non può fare.
 *
 * - Trasferimento (`T`): i wallet indicati sono dell'utente e la categoria è la sua
 *   categoria di sistema di tipo `T` ("Trasferimento", migrazione 011).
 * - Entrata o spesa: la categoria non è quella di tipo `T`.
 *
 * Per entrate e spese non si verifica altro di proposito: nel database live 24
 * transazioni hanno una categoria di tipo diverso dal loro e una ha la categoria di
 * un altro utente (9/11/2026). Un controllo più severo impedirebbe di modificarle;
 * vanno sistemate a parte (TODO_SALVADANAI.md).
 *
 * @returns {Promise<string|null>} messaggio d'errore, o null se va tutto bene
 */
const checkTransactionReferences = async (userId, body) => {
  const { data: category, error: categoryError } = await supabase
    .from("Category")
    .select("id, type")
    .eq("id", body.category_id)
    .eq("userid", userId)
    .maybeSingle();
  if (categoryError) throw new Error(categoryError.message);

  if (body.type !== "T") {
    return category?.type === "T"
      ? "the transfer category can only be used by transfers (type T)"
      : null;
  }

  if (category?.type !== "T") {
    return "a transfer must use the transfer category (type T)";
  }

  for (const walletId of [body.wallet_id, body.to_wallet_id]) {
    if (walletId == null) continue;
    const { data: wallet, error: walletError } = await supabase
      .from("Wallet")
      .select("id")
      .eq("id", walletId)
      .eq("userid", userId)
      .maybeSingle();
    if (walletError) throw new Error(walletError.message);
    if (!wallet) return `wallet ${walletId} not found`;
  }

  return null;
};

// GET all transactions (entrate, spese e trasferimenti), con `startDate` / `endDate`
// facoltativi come `/income/all` e `/expense/all`: li usa la pagina Movements del client.
router.get(
  "/all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    let result;
    try {
      result = await fetchAllRows(() => {
        let query = supabase
          .from("Transaction")
          .select("*", { count: "exact" })
          .eq("userid", req.user.id)
          .order("date", { ascending: false })
          // Tiebreaker univoco: senza di esso le pagine possono ripetersi o saltare righe.
          .order("id", { ascending: false });
        if (startDate) query = query.gte("date", startDate);
        if (endDate) query = query.lte("date", endDate);
        return query;
      });
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
    const { description, note, amount, date, type, wallet_id, to_wallet_id, category_id } =
      req.body;

    const referenceError = await checkTransactionReferences(req.user.id, req.body);
    if (referenceError) return res.status(400).json({ error: referenceError });

    const { data, error } = await supabase
      .from("Transaction")
      .insert({
        userid: req.user.id,
        description,
        note,
        amount,
        date,
        type,
        wallet_id: wallet_id ?? null,
        to_wallet_id: to_wallet_id ?? null,
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
    const { description, note, amount, date, type, wallet_id, to_wallet_id, category_id } =
      req.body;

    const referenceError = await checkTransactionReferences(req.user.id, req.body);
    if (referenceError) return res.status(400).json({ error: referenceError });

    // Categoria prima della modifica: serve a capire se l'utente l'ha corretta.
    const { data: previous } = await supabase
      .from("Transaction")
      .select("category_id")
      .eq("id", id)
      .eq("userid", req.user.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("Transaction")
      .update({
        description,
        note,
        amount,
        date,
        type,
        wallet_id: wallet_id ?? null,
        to_wallet_id: to_wallet_id ?? null,
        category_id,
      })
      .eq("id", id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Una correzione della categoria di un movimento importato dalla banca diventa una
    // regola locale (utils/categoryRules.js): la prossima volta lo stesso negozio prende
    // da solo questa categoria. Un errore qui non deve far fallire la modifica.
    try {
      await learnRuleFromCorrection(supabase, {
        userId: req.user.id,
        previousCategoryId: previous?.category_id,
        transaction: data,
      });
    } catch (learnError) {
      console.error("Could not learn category rule:", learnError.message);
    }

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
