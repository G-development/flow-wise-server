import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { categoryCreateSchema, categoryUpdateSchema } from "../utils/schemas.js";

const router = express.Router();

// GET all categories for logged user
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("Category")
      .select("*")
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  })
);

// GET all categories for logged user
router.get(
  "/active",
  requireAuth,
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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const { error } = await supabase
      .from("Category")
      .delete()
      .eq("id", req.params.id)
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Category deleted successfully" });
  })
);

export default router;
