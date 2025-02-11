import express from "express";
import { Expense, Category } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

router.post("/new", authMiddleware, async (req, res) => {
  const { amount, category } = req.body;

  try {
    const cat = await Category.findOne({ name: category });

    if (!cat) {
      return res.status(400).json({ msg: "Categoria non trovata" });
    }

    const newExpense = new Expense({
      user: req.user.id,
      amount,
      category: cat._id,
    });
    await newExpense.save();

    res.status(201).json(newExpense);
  } catch (error) {
    res.status(500).json({ msg: "expense/new", message: error.message });
    console.error(error);
  }
});

export default router;
