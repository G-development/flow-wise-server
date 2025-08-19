import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";

const router = express.Router();

// GET all categories for logged user
router.get("/", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Category")
      .select("*")
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// GET all categories for logged user
router.get("/active", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Category")
      .select("*")
      .eq("userid", req.user.id)
      .eq("active", true);

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// GET category by id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("Category")
      .select("*")
      .eq("id", req.params.id)
      .eq("userid", req.user.id)
      .single();

    if (error) return res.status(404).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// POST create category
router.post("/", requireAuth, async (req, res) => {
  const { name, type } = req.body;

  try {
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
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// PUT update category
router.put("/:id", requireAuth, async (req, res) => {
  const { name, type } = req.body;

  try {
    const { data, error } = await supabase
      .from("Category")
      .update({ name, type })
      .eq("id", req.params.id)
      .eq("userid", req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// DELETE category
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("Category")
      .delete()
      .eq("id", req.params.id)
      .eq("userid", req.user.id);

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: "Category deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
