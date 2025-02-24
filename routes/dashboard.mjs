import express from "express";
import mongoose from "mongoose";
import { Income, Expense } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// GET Dashboard Data (transactions + totals + charts)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const [
      incomes,
      expenses,
      incomeTotal,
      expenseTotal,
      incomeByDay,
      expenseByDay,
      expensesByCategory,
    ] = await Promise.all([
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
      Income.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            date: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $dayOfMonth: "$date" },
            totalAmount: { $sum: "$amount" },
          },
        },
        {
          $project: {
            day: "$_id",
            income: "$totalAmount",
            _id: null,
          },
        },
        { $sort: { day: 1 } },
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
            _id: { $dayOfMonth: "$date" },
            totalAmount: { $sum: "$amount" },
          },
        },
        {
          $project: {
            day: "$_id",
            expense: "$totalAmount",
            _id: null,
          },
        },
        { $sort: { day: 1 } },
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
            _id: "$category",
            totalAmount: { $sum: "$amount" },
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "_id",
            foreignField: "_id",
            as: "categoryInfo",
          },
        },
        {
          $unwind: "$categoryInfo",
        },
        {
          $project: {
            category: "$categoryInfo.name",
            totalAmount: 1,
            _id: 0,
          },
        },
        { $sort: { totalAmount: -1 } },
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

    // Merge income and expense data by day for charts
    const income_expense = [];
    const maxDay = Math.max(start.getDate(), end.getDate());

    for (let i = start.getDate(); i <= maxDay; i++) {
      const incomeDay = incomeByDay.find((item) => item.day === i);
      const expenseDay = expenseByDay.find((item) => item.day === i);

      const date = new Date(start);
      date.setDate(i);

      income_expense.push({
        date: date.toISOString().split("T")[0],
        income: incomeDay ? incomeDay.income : 0,
        expense: expenseDay ? expenseDay.expense : 0,
      });
    }

    const expense_category = expensesByCategory.map((expense, i) => ({
      category: expense.category,
      value: expense.totalAmount,
      fill: `hsl(var(--chart-${(i % 5) + 1}))`, // Colori definiti in CSS
    }));

    res.json({
      income: incomes,
      expense: expenses,
      totals: {
        income: incomeTotal.length > 0 ? incomeTotal[0].totalAmount : 0,
        expense: expenseTotal.length > 0 ? expenseTotal[0].totalAmount : 0,
      },
      net:
        (incomeTotal[0]?.totalAmount || 0) - (expenseTotal[0]?.totalAmount || 0),
      savingsRate: savingsRate,
      charts: {
        income_expense: income_expense,
        expense_category: expense_category,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ message: "Server error" });
  }
});


export default router;
