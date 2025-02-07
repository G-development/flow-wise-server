import express from "express";
import dotenv from "dotenv";

import connectMongoDB from "./db/connection.mjs";
import userRoutes from "./routes/users.mjs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("API funzionante!").status(200);
});

app.get("/hello", (req, res) => {
  res.send("Hello works!");
});

connectMongoDB()
  .then(() => {
    app.use("/getUsers", userRoutes);
  })
  .catch((err) => {
    console.error("Errore nella connessione al DB", err);
  });

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}\n`);
});
