import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "./authMiddleware.mjs";

import { Income, Expense, Category } from "./models.mjs";

const router = express.Router();

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { income = [], expense = [] } = req.body;
    const userId = req.user.id;

    const userCategories = await Category.find({ user: userId });
    const categoryMap = new Map(
      userCategories.map((c) => [c.name.trim().toLowerCase(), c._id])
    );

    const isValidEntry = (entry) =>
      typeof entry.amount === "number" &&
      !isNaN(new Date(entry.date).getTime()) &&
      typeof entry.category === "string" &&
      categoryMap.has(entry.category.trim().toLowerCase());

    const normalize = (entry) => ({
      user: new mongoose.Types.ObjectId(userId),
      amount: entry.amount,
      date: entry.date,
      category: categoryMap.get(entry.category.trim().toLowerCase()),
    });

    const incomeDocs = income.filter(isValidEntry).map(normalize);
    const expenseDocs = expense.filter(isValidEntry).map(normalize);

    if (incomeDocs.length) await Income.insertMany(incomeDocs);
    if (expenseDocs.length) await Expense.insertMany(expenseDocs);

    res.status(200).json({
      success: true,
      imported: {
        income: incomeDocs.length,
        expense: expenseDocs.length,
      },
    });
  } catch (err) {
    console.error("Import error:", err);
    res
      .status(500)
      .json({ error: "Errore durante l'import", details: err.message });
  }
});

export default router;
