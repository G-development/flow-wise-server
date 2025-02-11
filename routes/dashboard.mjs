import express from "express";
import { User } from "./models.mjs";
import { Income, Expense, Category, Budget } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

const replaceCategoryIdsWithNames = (data, categoryMap) => {
  if (!Array.isArray(data)) return data; // Se non è un array, restituisci com'è

  return data.map((item) => ({
    ...item.toObject(),
    category: categoryMap[item.category?.toString()] || item.category,
  }));
};

router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ msg: "User not found" });
    // res.json({ user });

    const categories = await Category.find({ user: req.user.id });
    const categoryMap = categories.reduce((map, cat) => {
      map[cat._id.toString()] = cat.name;
      return map;
    }, {});

    // res.json(filteredResponse);
    const dataSources = { income: Income, expense: Expense, budget: Budget };
    const results = await Promise.all(
      Object.entries(dataSources).map(async ([key, model]) => {
        const data = await model
          .find({ user: req.user.id })
          .select("-createdAt -updatedAt -__v");
        return [key, replaceCategoryIdsWithNames(data, categoryMap)];
      })
    );

    // Costruzione della risposta filtrata
    const response = Object.fromEntries(results);

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
    console.error(error);
  }
});

export default router;
