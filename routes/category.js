import express from "express";
import { supabase as supabaseClient } from "../config/supabaseClient.js";
import { requireAuth as requireAuthMiddleware } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { categoryCreateSchema, categoryMergeSchema, categoryUpdateSchema } from "../utils/schemas.js";
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

  /**
   * La categoria di tipo `T` è quella di sistema "Trasferimento" (migrazione 011): ogni
   * trasferimento la usa, quindi non si elimina, non si disattiva e non cambia tipo.
   * Si può solo rinominare. `isTransfer` dice se la categoria è quella di sistema; un
   * `error` di lettura va rifiutato come gli errori dei conteggi di guardia: senza sapere
   * che categoria è, non si modifica né si elimina niente.
   */
  const findTransferCategory = async (userId, id) => {
    const { data, error } = await supabase
      .from("Category")
      .select("id, type")
      .eq("id", id)
      .eq("userid", userId)
      .maybeSingle();
    return { isTransfer: data?.type === "T", error };
  };

  const SYSTEM_CATEGORY_ERROR = {
    error: "the transfer category is managed by the app: it can be renamed, not deleted, deactivated or retyped",
    code: "SYSTEM_CATEGORY",
  };

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

  /**
   * GET /category/stats — per ogni categoria dell'utente: movimenti, totale dell'anno in corso
   * (in centesimi, per il tipo della categoria: un rimborso abbassa la spesa), ultimo uso e numero
   * di regole (13/11/2026, nuova pagina Categorie). Le liste si leggono intere con fetchAllRows.
   */
  router.get(
    "/stats",
    auth,
    asyncHandler(async (req, res) => {
      const year = String(new Date().getUTCFullYear());
      let movements;
      let rules;
      try {
        [movements, rules] = await Promise.all([
          fetchAllRows(() =>
            supabase
              .from("Transaction")
              .select("id, category_id, amount, type, is_refund, date")
              .eq("userid", req.user.id)
              .order("id")
          ),
          fetchAllRows(() =>
            supabase.from("category_rules").select("id, category_id").eq("user_id", req.user.id).order("id")
          ),
        ]);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (movements.truncated || rules.truncated) {
        return res.status(400).json({ error: "Too many rows to compute the category stats" });
      }

      const stats = {};
      const entry = (id) => (stats[id] ??= { movements: 0, yearCents: 0, lastUsed: null, rules: 0 });
      for (const row of movements.rows) {
        if (row.category_id == null) continue;
        const item = entry(row.category_id);
        item.movements += 1;
        if (!item.lastUsed || String(row.date) > item.lastUsed) item.lastUsed = String(row.date).slice(0, 10);
        if (String(row.date).startsWith(year)) {
          const cents = Math.round(Math.abs(Number(row.amount) || 0) * 100);
          item.yearCents += row.is_refund ? -cents : cents;
        }
      }
      for (const rule of rules.rows) entry(rule.category_id).rules += 1;

      res.status(200).json({ year: Number(year), stats });
    })
  );

  /**
   * POST /category/:id/merge — unisce la categoria `:id` in `into_id` (13/11/2026): movimenti,
   * regole e budget passano alla seconda, poi la prima si elimina. Stesso tipo, mai la categoria
   * di sistema dei trasferimenti, sempre dell'utente del token. Non e' una transazione unica: ogni
   * passo e' ripetibile, e se uno fallisce ci si ferma prima di eliminare.
   */
  router.post(
    "/:id/merge",
    auth,
    validate(categoryMergeSchema),
    asyncHandler(async (req, res) => {
      const sourceId = Number(req.params.id);
      const intoId = req.body.into_id;
      if (!Number.isInteger(sourceId) || sourceId === intoId) {
        return res.status(400).json({ error: "Pick a different category to merge into" });
      }
      const { data: pair, error: readError } = await supabase
        .from("Category")
        .select("id, type, name")
        .eq("userid", req.user.id)
        .in("id", [sourceId, intoId]);
      if (readError) return res.status(400).json({ error: readError.message });
      const source = (pair ?? []).find((c) => Number(c.id) === sourceId);
      const into = (pair ?? []).find((c) => Number(c.id) === intoId);
      if (!source || !into) return res.status(404).json({ error: "Category not found" });
      if (source.type === "T" || into.type === "T") return res.status(409).json(SYSTEM_CATEGORY_ERROR);
      if (source.type !== into.type) {
        return res.status(400).json({ error: "Both categories must be of the same type" });
      }

      const moves = [
        ["Transaction", "category_id", "userid"],
        ["category_rules", "category_id", "user_id"],
        ["Budget", "categoryid", "userid"],
      ];
      const moved = {};
      for (const [table, column, owner] of moves) {
        const { error, count } = await supabase
          .from(table)
          .update({ [column]: intoId }, { count: "exact" })
          .eq(owner, req.user.id)
          .eq(column, sourceId);
        if (error) return res.status(400).json({ error: `Merge stopped at ${table}: ${error.message}` });
        moved[table] = count ?? 0;
      }

      const { error: deleteError } = await supabase
        .from("Category")
        .delete()
        .eq("id", sourceId)
        .eq("userid", req.user.id);
      if (deleteError) return res.status(400).json({ error: deleteError.message });

      res.status(200).json({ mergedInto: intoId, moved });
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

      if (type !== undefined || active === false) {
        const lookup = await findTransferCategory(req.user.id, req.params.id);
        if (lookup.error) return res.status(400).json({ error: lookup.error.message });
        if (lookup.isTransfer) return res.status(409).json(SYSTEM_CATEGORY_ERROR);
      }

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
      const lookup = await findTransferCategory(req.user.id, req.params.id);
      if (lookup.error) return res.status(400).json({ error: lookup.error.message });
      if (lookup.isTransfer) return res.status(409).json(SYSTEM_CATEGORY_ERROR);

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
