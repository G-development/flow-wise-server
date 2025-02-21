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
      // Aggregate income and expense by day for charts
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
    const chartData = [];
    const maxDay = Math.max(start.getDate(), end.getDate());

    for (let i = start.getDate(); i <= maxDay; i++) {
      const incomeDay = incomes.find((item) => item.date.getDate() === i);
      const expenseDay = expenses.find((item) => item.date.getDate() === i);

      const date = new Date(start);
      date.setDate(i);

      chartData.push({
        date: date.toISOString().split("T")[0], //`Day ${i}`,
        income: incomeDay ? incomeDay.amount : 0,
        expense: expenseDay ? expenseDay.amount : 0,
      });
    }

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
      charts: {
        income_expense: chartData,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
