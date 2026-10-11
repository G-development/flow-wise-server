import express from "express";
import { supabase as supabaseClient } from "../config/supabaseClient.js";
import { requireAuth as requireAuthMiddleware } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { categoryCreateSchema, categoryUpdateSchema } from "../utils/schemas.js";

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
      const { data, error } = await supabase
        .from("Category")
        .select("*")
        .eq("userid", req.user.id);

      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    })
  );

  // GET all active categories for logged user
  router.get(
    "/active",
    auth,
    asyncHandler(async (req, res) => {
      const { data, error } = await supabase
        .from("Category")
        .select("*")
        .eq("userid", req.user.id)
        .eq("active", true);

      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
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
      // `Transaction.category_id` is a foreign key with no ON DELETE action, so
      // deleting a category that is still referenced either fails with a raw
      // Postgres error or leaves orphan transactions behind. Count the references
      // first and refuse explicitly: a rejection the user can act on beats a leaked
      // constraint message.
      const { count, error: countError } = await supabase
        .from("Transaction")
        .select("id", { count: "exact", head: true })
        .eq("userid", req.user.id)
        .eq("category_id", req.params.id);

      // No count means we cannot know whether the category is in use, so nothing is
      // deleted either way. Same error shape as the rest of this router.
      if (countError) return res.status(400).json({ error: countError.message });

      if (count > 0) {
        return res.status(409).json({
          error: `Category is in use by ${count} transaction${
            count === 1 ? "" : "s"
          }; reassign or remove them first`,
          code: "CATEGORY_IN_USE",
          transactionCount: count,
        });
      }

      const { error } = await supabase
        .from("Category")
        .delete()
        .eq("id", req.params.id)
        .eq("userid", req.user.id);

      if (error) {
        // 23503 = foreign key violation: something the count above does not cover
        // (another table, or rows written between the count and the delete). Still a
        // conflict for the user, still not a raw database message.
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
