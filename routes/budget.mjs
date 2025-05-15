import express from "express";
import mongoose from "mongoose";
import { Budget, Category } from "../models/models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// GET all budgets
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const allBudgets = await Budget.find({ user: userId }).populate(
      "category",
      "name"
    );
    res.json(allBudgets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new budget
router.post("/new", authMiddleware, async (req, res) => {
  const { amount, category } = req.body;

  if (!amount || amount <= 0 || !category) {
    return res.status(400).json({ error: "Invalid amount or category" });
  }

  try {
    const cat = await Category.findOne({ user: req.user.id, name: category });

    if (!cat) {
      return res.status(400).json({ msg: "Category not found" });
    }

    console.log("amount", amount);

    const newBudget = new Budget({
      user: req.user.id,
      amount,
      category: cat._id,
    });

    await newBudget.save();
    res.status(201).json(newBudget);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
