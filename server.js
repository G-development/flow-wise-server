import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import userRoutes from "./routes/user.js";
import transactionRoutes from "./routes/transaction.js";
import incomeRoutes from "./routes/income.js";
import expenseRoutes from "./routes/expense.js";
import categoryRoutes from "./routes/category.js";
import walletRoutes from "./routes/wallet.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5030;

app.use(express.json({ limit: "10mb" }));

// CORS con origini configurabili da env (virgola-separate)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => {
  res.status(200).send("Flow-Wise API is working!");
});

app.get("/hello", (req, res) => {
  res.status(200).send("Hello world!");
});

// Healthcheck
app.get("/healthz", (req, res) => {
  res.status(204).end();
});

app.use("/users", userRoutes);

app.use("/transaction", transactionRoutes);

app.use("/income", incomeRoutes);

app.use("/expense", expenseRoutes);

app.use("/category", categoryRoutes);

app.use("/wallet", walletRoutes);

// 404 route
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server avviato su PORT:${PORT}\n`);
});
