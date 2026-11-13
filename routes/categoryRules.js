import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { categoryRuleCreateSchema } from "../utils/schemas.js";
import { fetchAllRows, toListResponse } from "../utils/paginatedSelect.js";
import { normalizeForRules, upsertRule } from "../utils/categoryRules.js";

/**
 * Regole di categoria visibili e modificabili (13/11/2026, nuova pagina Categorie). Fino a oggi
 * le regole si imparavano dalle correzioni ma non si vedevano. Sono **per utente**: ogni query
 * filtra per l'utente del token.
 *
 * - GET /category-rules — tutte le regole, con parola chiave, tipo, categoria e origine;
 * - POST /category-rules — una regola a mano: la parola viene normalizzata come quelle imparate
 *   (minuscole, senza accenti ne' numeri); se esiste gia' per quel tipo, passa alla nuova categoria;
 * - DELETE /category-rules/:id — toglie una regola.
 */
const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    let result;
    try {
      result = await fetchAllRows(() =>
        supabase
          .from("category_rules")
          .select("id, keyword, type, category_id, source, updated_at", { count: "exact" })
          .eq("user_id", req.user.id)
          .order("keyword")
          .order("id")
      );
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    res.status(200).json(toListResponse(result));
  })
);

router.post(
  "/",
  requireAuth,
  validate(categoryRuleCreateSchema),
  asyncHandler(async (req, res) => {
    const keyword = normalizeForRules(req.body.keyword);
    if (keyword.length < 2) {
      return res.status(400).json({ error: "The keyword needs letters (numbers and symbols are ignored)" });
    }
    const { data: category, error } = await supabase
      .from("Category")
      .select("id, type")
      .eq("id", req.body.category_id)
      .eq("userid", req.user.id)
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (category.type !== "I" && category.type !== "E") {
      return res.status(400).json({ error: "Rules by hand work for income and expense categories" });
    }
    try {
      const rule = await upsertRule(supabase, {
        userId: req.user.id,
        keyword,
        type: category.type,
        categoryId: category.id,
        source: "manual",
      });
      res.status(201).json(rule);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("category_rules")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id");
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Rule not found" });
    res.status(200).json({ deleted: Number(req.params.id) });
  })
);

export default router;
