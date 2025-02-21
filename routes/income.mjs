import express from "express";
import mongoose from "mongoose";
import { Income, Category } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

// // GET all incomes
// router.get("/all", authMiddleware, async (req, res) => {
//   try {
//     const userId = new mongoose.Types.ObjectId(req.user.id);
//     const allIncomes = await Income.find({ user: userId }).populate(
//       "category",
//       "name"
//     );
//     res.json(allIncomes);
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

    const allIncomes = await Income.find(filter).populate("category", "name");
    res.json(allIncomes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new income
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

    const newIncome = new Income({
      user: req.user.id,
      amount,
      category: cat._id,
    });

    await newIncome.save();
    res.status(201).json(newIncome);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET total amount - da definire meglio
router.get("/total", authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // da rivedere
    // if (!userId || !startDate || !endDate) {
    //   return res.status(400).json({ error: "Missing required parameters" });
    // }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const result = await Income.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(req.user.id),
          date: {
            $gte: start,
            $lte: end,
          },
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    console.log(result);

    res.json(result.length > 0 ? result[0] : { totalAmount: 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.error(error);
  }
});

// GET single income
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const income = await Income.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!income) {
      return res.status(404).json({ error: "Income not found" });
    }

    res.json(income);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE income
router.put("/:id", authMiddleware, async (req, res) => {
  const { amount, category, date } = req.body;

  try {
    let income = await Income.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!income) {
      return res.status(404).json({ error: "Income not found" });
    }

    // Da scommentare, momentaneamente disabilitato
    // if (category) {
    //   const cat = await Category.findOne({ user: req.user.id, name: category });
    //   if (!cat) {
    //     return res.status(400).json({ error: "Category not found" });
    //   }
    //   income.category = cat._id;
    // }

    if (amount && amount > 0) {
      income.amount = amount;
    } else if (amount) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (date) {
      // income.date = new Date(date).toLocaleDateString();
      income.date = new Date(date);
    }

    await income.save();
    res.json(income);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE income
router.delete("/delete/:id", authMiddleware, async (req, res) => {
  try {
    const deletedIncome = await Income.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!deletedIncome) {
      return res.status(404).json({ error: "Income not found" });
    }

    res.json({ message: "Income deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// // GET totals - da definire meglio
// router.get("/totals", authMiddleware, async (req, res) => {
//   try {
//     const userId = new mongoose.Types.ObjectId(req.user.id);
//     const totalEntriesByCategory = await Income.aggregate([
//       { $match: { user: userId } },
//       {
//         $lookup: {
//           from: "categories",
//           localField: "category",
//           foreignField: "_id",
//           as: "category",
//         },
//       },
//       { $unwind: "$category" }, // De-struttura la categoria
//       {
//         $group: {
//           _id: "$category.name", // Raggruppa per nome della categoria
//           totalAmount: { $sum: "$amount" }, // Somma gli importi
//         },
//       },
//     ]);

//     if (!totalEntriesByCategory || totalEntriesByCategory.length === 0) {
//       return res
//         .status(404)
//         .json({ msg: "Nessuna entrata trovata per l'utente." });
//     }

//     res.status(200).json(totalEntriesByCategory);
//   } catch (error) {
//     res.status(500).json({ msg: "income/totals", message: error.message });
//     console.error(error);
//   }
// });

export default router;
