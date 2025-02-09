import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectMongoDB from "./db/connection.mjs";

import userRoutes from "./routes/users.mjs";
import dashboardRoutes from "./routes/dashboard.mjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.use(cors());

app.get("/", (req, res) => {
  res.send("API funzionante!").status(200);
});

app.get("/hello", (req, res) => {
  res.send("Hello works!");
});

app.use("/users", userRoutes);

app.use("/dashboard", dashboardRoutes);

connectMongoDB()
  .then(() => {
    console.log("✅ Connection to MongoDB Atlas is working!");
  })
  .catch((err) => {
    console.error("❌ Errore in DB connection", err);
  });

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}\n`);
});
