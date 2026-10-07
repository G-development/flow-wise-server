import express from "express";
import dotenv from "dotenv";
import cors from "cors";

import userRoutes from "./routes/user.js";
import transactionRoutes from "./routes/transaction.js";
import incomeRoutes from "./routes/income.js";
import expenseRoutes from "./routes/expense.js";
import categoryRoutes from "./routes/category.js";
import walletRoutes from "./routes/wallet.js";
import dashboardLayoutRoutes from "./routes/dashboard-layout.js";
import importRoutes from "./routes/import.js";
import bankRoutes from "./routes/bank.js";
import authRoutes from "./routes/auth.js";
import agentRoutes from "./routes/agents.js";
import { startBankSyncScheduler } from "./utils/bankSyncScheduler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5030;

app.use(express.json({ limit: "10mb" }));

// Serve static files from public directory
app.use(express.static('public'));

// CORS con origini configurabili da env (virgola-separate) + fallback vercel
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3002,https://flow-wise-client.vercel.app")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedPatterns = [/\.vercel\.app$/];
const localDevelopmentOrigin =
  /^http:\/\/(?:localhost|127\.0\.0\.1):(?:3000|3001|3002)$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser requests
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (allowedPatterns.some((re) => re.test(origin))) return callback(null, true);
      if (localDevelopmentOrigin.test(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

app.get("/hello", (req, res) => {
  res.status(200).send("Hello world!");
});

// Healthcheck
app.get("/healthz", (req, res) => {
  res.status(204).end();
});

app.use("/users", userRoutes);

app.use("/auth", authRoutes);

app.use("/transaction", transactionRoutes);

app.use("/income", incomeRoutes);

app.use("/expense", expenseRoutes);

app.use("/category", categoryRoutes);

app.use("/wallet", walletRoutes);

app.use("/dashboard-layout", dashboardLayoutRoutes);

app.use("/import", importRoutes);

app.use("/bank", bankRoutes);

app.use("/agents", agentRoutes);

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
  
  // Avvia lo scheduler per la sincronizzazione bancaria
  startBankSyncScheduler();
});
