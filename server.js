import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import userRoutes from "./routes/user.js";
// import dashboardRoutes from "./routes/dashboard.mjs";
import transactionRoutes from "./routes/transaction.js";
import incomeRoutes from "./routes/income.js";
import expenseRoutes from "./routes/expense.js";
import categoryRoutes from "./routes/category.js";
import walletRoutes from "./routes/wallet.js";
// import budgetRoutes from "./routes/budget.mjs";
// import importRoute from "./routes/import.mjs";
// import goCardlessRoute from "./routes/gocardless.mjs";
// import externalTransactions from "./routes/externalTransactions.mjs";

dotenv.config();

const app = express({ limit: "10mb" });
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Flow-Wise API is working!").status(200);
});

app.get("/hello", (req, res) => {
  res.send("Hello world!");
});

app.use("/users", userRoutes);

// app.use("/dashboard", dashboardRoutes);

app.use("/transaction", transactionRoutes);

app.use("/income", incomeRoutes);

app.use("/expense", expenseRoutes);

app.use("/category", categoryRoutes);

app.use("/wallet", walletRoutes);

// app.use("/budget", budgetRoutes);

// app.use("/import", importRoute);

// app.use("/bank", goCardlessRoute);

// app.use("/externalTransactions", externalTransactions);

app.listen(PORT, () => {
  console.log(`\n🚀 Server avviato su http://localhost:${PORT}\n`);
});
