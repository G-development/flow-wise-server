import express from "express";
import { supabase as supabaseClient } from "../config/supabaseClient.js";
import { requireAuth as requireAuthMiddleware } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { categoryCreateSchema, categoryUpdateSchema } from "../utils/schemas.js";
import { fetchAllRows, toListResponse } from "../utils/paginatedSelect.js";

/**
 * The router is built by a factory so tests can inject a fake Supabase client and a
 * fake `requireAuth`. Without a seam here the only way to exercise the handlers would
 * be talking to the real database.
 */
export const createCategoryRouter = ({
  supabase = supabaseClient,
  auth = requireAuthMiddleware,
} = {}) => {
  const router = express.Router();

  // GET all categories for logged user
  router.get(
    "/",
    auth,
    asyncHandler(async (req, res) => {
      // Envelope `{ data, count, truncated, total }` (utils/paginatedSelect.js):
      // una `select()` una-shot si ferma al tetto PostgREST (1000 righe) senza
      // dirlo, quindi il client mostrerebbe un elenco incompleto come se fosse
      // completo. Il tiebreaker `.order("id")` rende l'ordinamento totale: senza,
      // le pagine possono ripetersi o saltare righe.
      let result;
      try {
        result = await fetchAllRows(() =>
          supabase
            .from("Category")
            .select("*", { count: "exact" })
            .eq("userid", req.user.id)
            .order("id")
        );
      } catch (err) {
        // Stesso esito di prima dell'helper (che lancia sul primo errore PostgREST).
        return res.status(400).json({ error: err.message });
      }

      res.status(200).json(toListResponse(result));
    })
  );

  // GET all active categories for logged user
  router.get(
    "/active",
    auth,
    asyncHandler(async (req, res) => {
      let result;
      try {
        result = await fetchAllRows(() =>
          supabase
            .from("Category")
            .select("*", { count: "exact" })
            .eq("userid", req.user.id)
            .eq("active", true)
            .order("id")
        );
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      res.status(200).json(toListResponse(result));
    })
  );

  // GET category by id
  router.get(
    "/:id",
    auth,
    asyncHandler(async (req, res) => {
      const { data, error } = await supabase
        .from("Category")
        .select("*")
        .eq("id", req.params.id)
        .eq("userid", req.user.id)
        .single();

      if (error) return res.status(404).json({ error: error.message });
      res.json(data);
    })
  );

  // POST create category
  router.post(
    "/",
    auth,
    validate(categoryCreateSchema),
    asyncHandler(async (req, res) => {
      const { name, type } = req.body;

      const { data, error } = await supabase
        .from("Category")
        .insert({
          userid: req.user.id,
          name,
          type,
        })
        .select()
        .single();

      if (error) return res.status(400).json({ error: error.message });
      res.status(201).json(data);
    })
  );

  // PUT update category
  router.put(
    "/:id",
    auth,
    validate(categoryUpdateSchema),
    asyncHandler(async (req, res) => {
      const { name, type, active } = req.body;

      const { data, error } = await supabase
        .from("Category")
        .update({ name, type, active })
        .eq("id", req.params.id)
        .eq("userid", req.user.id)
        .select()
        .single();

      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    })
  );

  // DELETE category
  router.delete(
    "/:id",
    auth,
    asyncHandler(async (req, res) => {
      // Two tables reference `Category`:
      //   `Transaction.category_id` -> no ON DELETE action (a raw Postgres error)
      //   `Budget.categoryid`       -> ON DELETE CASCADE (the budgets disappear silently)
      // Counting only `Transaction` let a category referenced by a budget alone pass the
      // guard, be deleted with a 200 and take its budgets down without a word. Count both,
      // always scoped to the authenticated user, and refuse naming what blocks: an explicit
      // rejection the user can act on beats a leaked constraint or a silent cascade.
      // Migration 006 moves the Budget side to RESTRICT as a backstop at the DB level; the
      // 23503 branch after the delete stays as the net under this guard.
      const [transactions, budgets] = await Promise.all([
        supabase
          .from("Transaction")
          .select("id", { count: "exact", head: true })
          .eq("userid", req.user.id)
          .eq("category_id", req.params.id),
        supabase
          .from("Budget")
          .select("id", { count: "exact", head: true })
          .eq("userid", req.user.id)
          .eq("categoryid", req.params.id),
      ]);

      // No count means we cannot know whether the category is in use, so nothing is
      // deleted either way. Same error shape as the rest of this router.
      if (transactions.error) {
        return res.status(400).json({ error: transactions.error.message });
      }
      if (budgets.error) {
        return res.status(400).json({ error: budgets.error.message });
      }

      // `count: "exact"` can also come back with a null count and no error at all:
      // @supabase/postgrest-js reads the count from the `Content-Range` header, so a
      // provider that omits it yields `count: null`. That is the same blind spot as a
      // failed count — we cannot know whether the category is in use — so it is refused
      // the same way. `?? 0` would turn "unknown" into "free" and let the delete take the
      // referencing rows down silently, the exact failure mode this guard exists to stop.
      const transactionCount = transactions.count;
      const budgetCount = budgets.count;

      if (transactionCount == null || budgetCount == null) {
        const unknown = [
          ...(transactionCount == null ? ["Transaction"] : []),
          ...(budgetCount == null ? ["Budget"] : []),
        ];
        return res.status(400).json({
          error: `cannot verify whether the category is in use (${unknown.join(
            " and "
          )} count unavailable)`,
        });
      }

      if (transactionCount > 0 || budgetCount > 0) {
        const blockers = [];
        if (transactionCount > 0) {
          blockers.push(
            `${transactionCount} transaction${transactionCount === 1 ? "" : "s"}`
          );
        }
        if (budgetCount > 0) {
          blockers.push(`${budgetCount} budget${budgetCount === 1 ? "" : "s"}`);
        }

        return res.status(409).json({
          error: `Category is in use by ${blockers.join(
            " and "
          )}; reassign or remove them first`,
          code: "CATEGORY_IN_USE",
          transactionCount,
          budgetCount,
        });
      }

      const { error } = await supabase
        .from("Category")
        .delete()
        .eq("id", req.params.id)
        .eq("userid", req.user.id);

      if (error) {
        // 23503 = foreign key violation: something the counts above do not cover (a table
        // added later, or rows written between the count and the delete). After migration
        // 006 this is also what a `Budget` reference raises if the guard were ever skipped.
        // Still a conflict for the user, still not a raw database message.
        if (error.code === "23503") {
          return res.status(409).json({
            error:
              "Category is in use and cannot be deleted; reassign or remove the referencing rows first",
            code: "CATEGORY_IN_USE",
          });
        }
        return res.status(400).json({ error: error.message });
      }

      res.json({ message: "Category deleted successfully" });
    })
  );

  return router;
};

export default createCategoryRouter();
