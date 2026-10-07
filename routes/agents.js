import express from "express";
import { z } from "zod";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import {
  analyzeExpensesWithAI,
  summarizeExpensesForAI,
} from "../agents/analyticsAgent.js";

const router = express.Router();
const maxTransactions = 1000;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La data deve essere nel formato YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "La data non è valida");

const analyticsRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000).optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
  })
  .strict();

router.post(
  "/analytics",
  requireAuth,
  validate(analyticsRequestSchema),
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = req.body.startDate ?? `${today.slice(0, 8)}01`;
    const endDate = req.body.endDate ?? today;

    if (startDate > endDate) {
      return res.status(400).json({
        error: "Intervallo non valido",
        details: [{ path: "startDate", message: "startDate deve precedere endDate" }],
      });
    }

    const { data: transactions, error: transactionError } = await supabase
      .from("Transaction")
      .select("id, description, amount, date, category_id")
      .eq("userid", req.user.id)
      .eq("type", "E")
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(0, maxTransactions);

    if (transactionError) {
      console.error("Expense analytics transaction query error:", transactionError);
      return res.status(500).json({ error: "Impossibile recuperare le spese" });
    }

    if (transactions.length > maxTransactions) {
      return res.status(400).json({
        error: `Intervallo troppo ampio: limita l'analisi a ${maxTransactions} spese o meno`,
      });
    }

    const categoryIds = [
      ...new Set(
        transactions
          .map((transaction) => transaction.category_id)
          .filter((categoryId) => categoryId != null)
      ),
    ];
    let categories = [];

    if (categoryIds.length > 0) {
      const { data, error } = await supabase
        .from("Category")
        .select("id, name")
        .eq("userid", req.user.id)
        .in("id", categoryIds);

      if (error) {
        console.error("Expense analytics category query error:", error);
        return res.status(500).json({ error: "Impossibile analizzare le categorie" });
      }

      categories = data;
    }

    const expensesForModel = summarizeExpensesForAI(transactions, categories);
    const question =
      req.body.question ??
      "Analizza le mie spese nel periodo: riassumi il totale, le categorie principali e gli eventuali andamenti o anomalie che emergono dai dati.";
    let analysis;
    try {
      analysis = await analyzeExpensesWithAI({
        question,
        period: { startDate, endDate },
        transactions: expensesForModel,
      });
    } catch (error) {
      if (Number.isInteger(error.status)) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }

    res.status(200).json({
      agent: "expense-analytics",
      period: { startDate, endDate },
      transactionsAnalyzed: transactions.length,
      analysis,
    });
  })
);

export default router;
