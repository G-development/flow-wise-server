import express from "express";
import mongoose from "mongoose";
import { User } from "./models.mjs";
import { Category } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

router.get("/all", authMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const user = await User.findById(userId).select("-password");
    if (!user) return res.status(404).json({ msg: "Utente non trovato" });

    const category = await Category.find({ user: userId }).select(
      "_id name type"
    );

    const response = {
      category: category,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ msg: "category/all", message: error.message });
    console.error(error);
  }
});

// POST new category
router.post("/new", authMiddleware, async (req, res) => {
  const { name, type } = req.body;

  try {
    const normalizedName = name.trim().toLowerCase();
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const cat = await Category.findOne({ user: userId, name: normalizedName });

    if (cat) {
      return res.status(400).json({ msg: "Category already exists." });
    }

    const newCategory = new Category({
      user: req.user.id,
      name: normalizedName,
      type: type,
    });
    await newCategory.save();

    res.status(201).json(newCategory);
  } catch (error) {
    res.status(500).json({ msg: "categeory/new", message: error.message });
    console.error(error);
  }
});

export default router;
