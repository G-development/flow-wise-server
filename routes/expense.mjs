import express from "express";
import mongoose from "mongoose";
import { Expense, Category } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// // GET all expenses
// router.get("/all", authMiddleware, async (req, res) => {
//   try {
//     const userId = new mongoose.Types.ObjectId(req.user.id);
//     const allExpense = await Expense.find({ user: userId }).populate(
//       "category",
//       "name"
//     );
//     res.json(allExpense);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

// GET all incomes with optional date filter
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let filter = { user: req.user.id };

    if (startDate && endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const allIncomes = await Expense.find(filter).populate("category", "name");
    res.json(allIncomes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new expense
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

    const newExpense = new Expense({
      user: req.user.id,
      amount,
      category: cat._id,
    });

    await newExpense.save();
    res.status(201).json(newExpense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single expense
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!expense) {
      return res.status(404).json({ error: "Expense not found" });
    }

    res.json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE expense
router.put("/:id", authMiddleware, async (req, res) => {
  const { amount, category } = req.body;

  try {
    let expense = await Expense.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!expense) {
      return res.status(404).json({ error: "Expense not found" });
    }

    if (category) {
      const cat = await Category.findOne({ user: req.user.id, name: category });
      if (!cat) {
        return res.status(400).json({ error: "Category not found" });
      }
      expense.category = cat._id;
    }

    if (amount && amount > 0) {
      expense.amount = amount;
    } else if (amount) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    await expense.save();
    res.json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE income
router.delete("/delete/:id", authMiddleware, async (req, res) => {
  try {
    const deletedExpense = await Expense.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!deletedExpense) {
      return res.status(404).json({ error: "Expense not found" });
    }

    res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
