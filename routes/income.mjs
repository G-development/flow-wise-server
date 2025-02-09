import express from "express";
import mongoose from "mongoose";
import { Income, Category } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// POST new income
router.post("/new", authMiddleware, async (req, res) => {
  const { amount, category } = req.body;

  try {
    const cat = await Category.findOne({ name: category });

    if (!cat) {
      return res.status(400).json({ msg: "Categoria non trovata" });
    }

    const newIncome = new Income({
      user: req.user.id,
      amount,
      category: cat._id,
    });
    await newIncome.save();

    res.status(201).json(newIncome);
  } catch (error) {
    res.status(500).json({ msg: "income/new", message: error.message });
    console.log(error.message);
  }
});

// GET all incomes
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const allIncomes = await Income.find({ user: userId });
    res.json(allIncomes);
  } catch (error) {
    res.status(500).json({ msg: "income/all", message: error.message });
    console.log(error.message);
  }
});

// GET totals - da definire meglio
router.get("/totals", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const totalEntriesByCategory = await Income.aggregate([
      { $match: { user: userId } },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: "$category" }, // De-struttura la categoria
      {
        $group: {
          _id: "$category.name", // Raggruppa per nome della categoria
          totalAmount: { $sum: "$amount" }, // Somma gli importi
        },
      },
    ]);

    console.log(totalEntriesByCategory);

    if (!totalEntriesByCategory || totalEntriesByCategory.length === 0) {
      return res
        .status(404)
        .json({ msg: "Nessuna entrata trovata per l'utente." });
    }

    res.status(200).json(totalEntriesByCategory);
  } catch (error) {
    res.status(500).json({ msg: "income/totals", message: error.message });
    console.log(error.message);
  }
});

export default router;
