import express from "express";
import mongoose from "mongoose";
import { Transaction } from "../models/transaction.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "Missing required parameters: startDate / endDate" });
    }

    const start = new Date(startDate);
    const end = new Date(new Date(endDate).setHours(23, 59, 59, 999));

    const transactions = await Transaction.find({
      userId: new mongoose.Types.ObjectId(userId),
      bookingDate: { $gte: start, $lte: end },
    })
      .sort({ date: -1 })
      .select("-_id -internalTransactionId -createdAt -updatedAt -__v");

    if (transactions.length != 0) res.json(transactions);
    else res.json("Nothing found!");
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
