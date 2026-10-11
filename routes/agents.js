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

/**
 * Numero massimo di movimenti letti per una singola analisi.
 *
 * Unico punto di verità del limite: la stessa costante dimensiona la pagina
 * della query (`.range(0, limit - 1)`, `range` è **inclusivo** su entrambi gli
 * estremi) e il numero dichiarato nella risposta. Non duplicare il valore come
 * letterale altrove: è così che il tetto e il conteggio possono divergere.
 *
 * Coincide con il tetto per richiesta di PostgREST su questo progetto: alzarlo
 * non fa leggere più righe, serve un `limit` più basso solo per test/misure.
 */
export const AGENT_ROWS_LIMIT = 1000;

const DEFAULT_QUESTION =
  "Analizza le mie spese nel periodo: riassumi il totale, le categorie principali e gli eventuali andamenti o anomalie che emergono dai dati.";

const statusError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

/**
 * Applica alla query i filtri della finestra di analisi.
 * Deliberatamente unico: i dati e il conteggio totale devono vedere lo stesso
 * insieme di righe, altrimenti la dichiarazione di copertura mente.
 *
 * `query` è già passata per `.select(...)`: in supabase-js i filtri (`.eq`,
 * `.gte`, …) esistono solo dopo il `select`, non sul builder grezzo di `from()`.
 */
export const applyExpenseFilters = (query, { userId, startDate, endDate }) =>
  query
    .eq("userid", userId)
    .eq("type", "E")
    .gte("date", startDate)
    .lte("date", endDate);

const EXPENSE_COLUMNS = "id, description, amount, date, category_id";

/** Query dati del periodo: selezione + filtri, senza tetto di righe. */
export const buildExpensesQuery = (client, { userId, startDate, endDate }) =>
  applyExpenseFilters(client.from("Transaction").select(EXPENSE_COLUMNS), {
    userId,
    startDate,
    endDate,
  });

/** Query di conteggio del periodo: solo `count`, nessuna riga scaricata. */
export const buildExpensesCountQuery = (client, { userId, startDate, endDate }) =>
  applyExpenseFilters(
    client.from("Transaction").select("id", { count: "exact", head: true }),
    { userId, startDate, endDate }
  );

/**
 * Legge al massimo `limit` movimenti del periodo e, separatamente, il numero
 * **totale** di movimenti del periodo.
 *
 * Il totale arriva da una count query (`head: true`), che chiede al database solo
 * il numero: nessuna riga in più scaricata in memoria. Il tetto di righe resta,
 * quindi su un periodo molto lungo si analizza una fetta — ma dichiarata.
 *
 * @returns {Promise<{transactions: Array<object>, rowsFetched: number, totalRows: number, limit: number}>}
 * @throws {Error} con `.status = 500` se una delle due query fallisce.
 */
export const fetchExpenseSlice = async ({
  client,
  userId,
  startDate,
  endDate,
  limit = AGENT_ROWS_LIMIT,
}) => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `fetchExpenseSlice: limit deve essere un intero >= 1 (ricevuto: ${limit})`
    );
  }

  const scope = { userId, startDate, endDate };

  // `range` è inclusivo su entrambi gli estremi: 0..limit-1 sono esattamente
  // `limit` righe. Con `.range(0, limit)` ne leggerebbe una in più del dichiarato.
  const { data, error } = await buildExpensesQuery(client, scope)
    .order("date", { ascending: false })
    .order("id", { ascending: true })
    .range(0, limit - 1);

  if (error) {
    console.error("Expense analytics transaction query error:", error);
    throw statusError(500, "Impossibile recuperare le spese");
  }

  const { count, error: countError } = await buildExpensesCountQuery(client, scope);

  // Il conteggio è stato richiesto esplicitamente: se manca, la risposta non
  // rispetta il contratto e non possiamo dichiarare la copertura. Meglio un
  // errore che un'analisi presentata come completa senza saperlo.
  if (countError || typeof count !== "number") {
    console.error("Expense analytics count query error:", countError ?? "count mancante");
    throw statusError(500, "Impossibile conteggiare le spese del periodo");
  }

  const transactions = data ?? [];

  return {
    transactions,
    rowsFetched: transactions.length,
    totalRows: count,
    limit,
  };
};

/**
 * Dichiarazione di copertura dell'analisi, in testo leggibile.
 *
 * `rowsFetched` e `totalRows` sono i conteggi reali (righe lette e totale del
 * periodo), mai valori fissi nel codice: il numero dichiarato all'utente è per
 * costruzione quello delle righe passate a `summarizeExpensesForAI`.
 *
 * @returns {{rowsFetched: number, totalRows: number, limit: number, truncated: boolean, notice: string}}
 */
export const buildCoverage = ({
  rowsFetched,
  totalRows,
  limit = AGENT_ROWS_LIMIT,
}) => {
  const truncated = totalRows > rowsFetched;
  const notice = truncated
    ? `Ho analizzato ${rowsFetched} movimenti su ${totalRows} del periodo. Il periodo contiene più movimenti del limite analizzabile (${limit}): l'analisi copre solo i primi ${rowsFetched}.`
    : `Ho analizzato ${rowsFetched} movimenti su ${totalRows} del periodo.`;

  return { rowsFetched, totalRows, limit, truncated, notice };
};

/**
 * Esegue un'analisi completa e restituisce il payload della risposta.
 *
 * Estratta dal handler per poterla esercitare nei test con un client Supabase
 * finto e un `analyze` finto: è la stessa funzione che serve la route.
 *
 * @throws {Error} con `.status` (500/502/503/504) da mappare in risposta HTTP.
 */
export const runExpenseAnalysis = async ({
  question,
  startDate,
  endDate,
  userId,
  client = supabase,
  analyze = analyzeExpensesWithAI,
}) => {
  const { transactions, rowsFetched, totalRows, limit } = await fetchExpenseSlice({
    client,
    userId,
    startDate,
    endDate,
  });

  const coverage = buildCoverage({ rowsFetched, totalRows, limit });

  const categoryIds = [
    ...new Set(
      transactions
        .map((transaction) => transaction.category_id)
        .filter((categoryId) => categoryId != null)
    ),
  ];
  let categories = [];

  if (categoryIds.length > 0) {
    const { data, error } = await client
      .from("Category")
      .select("id, name")
      .eq("userid", userId)
      .in("id", categoryIds);

    if (error) {
      console.error("Expense analytics category query error:", error);
      throw statusError(500, "Impossibile analizzare le categorie");
    }

    categories = data ?? [];
  }

  // Il riepilogo (e la sua matematica in centesimi) resta invariato e continua a
  // ricevere solo le righe lette, esattamente `rowsFetched`. La copertura non
  // entra qui: la dichiarazione la costruisce la route dai conteggi reali, così
  // non può divergere dalle righe effettivamente analizzate.
  const expensesForModel = summarizeExpensesForAI(transactions, categories);

  const analysis = await analyze({
    question: question ?? DEFAULT_QUESTION,
    period: { startDate, endDate },
    transactions: expensesForModel,
  });

  return {
    agent: "expense-analytics",
    period: { startDate, endDate },
    transactionsAnalyzed: rowsFetched,
    limit,
    totalTransactions: totalRows,
    truncated: coverage.truncated,
    // Stessi campi e stessa `notice` che finiscono nel testo: la copertura non
    // viene ricalcolata, così payload e frase mostrata non possono divergere.
    coverage,
    // La copertura precede la risposta del modello: è testo derivato dai
    // conteggi reali, non dal modello, quindi non può divergere dai dati.
    analysis: `${coverage.notice}\n\n${analysis}`,
  };
};

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

    try {
      const payload = await runExpenseAnalysis({
        question: req.body.question,
        startDate,
        endDate,
        userId: req.user.id,
      });
      res.status(200).json(payload);
    } catch (error) {
      if (Number.isInteger(error.status)) {
        return res.status(error.status).json({ error: error.message });
      }
      throw error;
    }
  })
);

export default router;
