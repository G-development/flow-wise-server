import express from "express";
import { User } from "./models.mjs";
import { Income, Expense, Category, Budget } from "./models.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  try {
    const user = await User.find({ _id: req.user.id });
    if (!user) return res.status(404).json({ msg: "Utente non trovato" });
    // res.json({ user });

    const income = await Income.find({ _id: req.user.id });
    const expense = await Expense.find({ _id: req.user.id });
    const category = await Category.find({ _id: req.user.id });
    const budget = await Budget.find({ _id: req.user.id });

    const response = {
      user: user,
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

  // console.log("req", req);
  // const user = await User.findOne({ _id: req.user });
  // if (!user) return res.status(404).json({ msg: "Utente non trovato" });

  // try {
  //   // const users = await User.find({ _id: req.user });
  //   const income = await Income.find({ _id: req.user });
  //   const expense = await Expense.find({ _id: req.user });
  //   const category = await Category.find({ _id: req.user });
  //   const budget = await Budget.find({ _id: req.user });

  //   const response = {
  //     user: user,
  //     income: income,
  //     expense: expense,
  //     category: category,
  //     budget: budget,
  //   };

  //   // res.json(response);

  //   const filteredResponse = Object.fromEntries(
  //     Object.entries(response).filter(
  //       ([_, value]) =>
  //         value !== null &&
  //         value !== undefined &&
  //         !(Array.isArray(value) && value.length === 0)
  //     )
  //   );

  //   res.json(filteredResponse);

  //   res.json(user);
  // } catch (error) {
  //   res.status(500).json({ msg: "/dashboard", message: error.message });
  //   console.log(error.message);
  // }
});

export default router;
