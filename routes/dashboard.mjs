import express from "express";
import mongoose from "mongoose";
import { Income, Expense } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// GET Dashboard Data (transactions + totals)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const [incomes, expenses, incomeTotal, expenseTotal] = await Promise.all([
      Income.find({
        user: new mongoose.Types.ObjectId(userId),
        date: { $gte: start, $lte: end },
      }).populate("category", "name"),
      Expense.find({
        user: new mongoose.Types.ObjectId(userId),
        date: { $gte: start, $lte: end },
      }).populate("category", "name"),
      Income.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            date: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
          },
        },
      ]),
      Expense.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            date: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const savingsRate =
      incomeTotal[0]?.totalAmount && incomeTotal[0].totalAmount > 0
        ? Math.max(
            ((incomeTotal[0].totalAmount - expenseTotal[0]?.totalAmount) /
              incomeTotal[0].totalAmount) *
              100,
            0
          ).toFixed(2) + "%"
        : "0%";

    res.json({
      income: incomes,
      expense: expenses,
      totals: {
        income: incomeTotal.length > 0 ? incomeTotal[0].totalAmount : 0,
        expense: expenseTotal.length > 0 ? expenseTotal[0].totalAmount : 0,
      },
      net:
        (incomeTotal[0]?.totalAmount || 0) -
        (expenseTotal[0]?.totalAmount || 0),
      savingsRate: savingsRate,
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
