import express from "express";
import { User } from "./models.mjs";
import { Income, Expense, Category, Budget } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.find({ _id: req.user.id }).select("-password");
    if (!user) return res.status(404).json({ msg: "Utente non trovato" });
    // res.json({ user });

    const income = await Income.find({ user: req.user.id });
    const expense = await Expense.find({ user: req.user.id });
    const category = await Category.find({ _id: req.user.id });
    const budget = await Budget.find({ _id: req.user.id });

    const response = {
      // user: user,
      income: income,
      expense: expense,
      category: category,
      budget: budget,
    };

    const filteredResponse = Object.fromEntries(
      Object.entries(response).filter(
        ([_, value]) =>
          value !== null &&
          value !== undefined &&
          !(Array.isArray(value) && value.length === 0)
      )
    );

    res.json(filteredResponse);
  } catch (error) {
    res.status(500).json({ msg: "/dashboard", message: error.message });
    console.log(error.message);
  }
});

export default router;
