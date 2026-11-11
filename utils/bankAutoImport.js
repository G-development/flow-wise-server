import { createClient } from "@supabase/supabase-js";
import { categorizeWithRules, loadRules } from "./categoryRules.js";
import {
  buildAppTransactionFromBank,
  insertImportedTransactions,
  markBankTransactionsImported,
} from "./bankService.js";

/**
 * Import automatico dei movimenti bancari in `Transaction` (job giornaliero di GitHub
 * Actions -> POST /bank/scheduler/import).
 *
 * Per ogni banca con un wallet di destinazione (`bank_connections.import_wallet_id`)
 * prende i movimenti:
 *   - mai importati (`status = 'synced'`),
 *   - contabilizzati (`booking_status = 'booked'`; i 'pending' e i NULL restano fuori),
 *   - con data >= `auto_import_from`, se impostata;
 * e decide la categoria con le regole locali dell'utente (`category_rules`, vedi
 * utils/categoryRules.js): nessun dato esce da Flow-Wise. Senza una regola che combacia il
 * movimento va in 'Altro' del tipo giusto; una regola verso "Trasferimento" lo fa entrare
 * come trasferimento da assegnare. Lavora a lotti (`limit`): il workflow richiama
 * l'endpoint finche' `remaining` e' 0.
 *
 * Il risultato contiene solo conteggi: finisce nei log pubblici di GitHub Actions.
 */

export const AUTO_IMPORT_DEFAULT_LIMIT = 50;
export const AUTO_IMPORT_MAX_LIMIT = 100;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const normalizeName = (name) =>
  String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/** Categoria 'Altro' attiva per tipo: `{ I: id|null, E: id|null }`. */
export const findFallbackCategories = (categories) => {
  const fallback = { I: null, E: null };
  for (const category of categories) {
    if (category.active === false) continue;
    if (normalizeName(category.name) !== "altro") continue;
    if ((category.type === "I" || category.type === "E") && fallback[category.type] == null) {
      fallback[category.type] = Number(category.id);
    }
  }
  return fallback;
};

export const bankTransactionType = (amount) => (Number(amount) >= 0 ? "I" : "E");

/**
 * Decide la categoria finale di ogni movimento.
 * @returns {Array<{row, categoryId: number|null, source: "rule"|"fallback"|"none"}>}
 */
export const resolveCategories = (rows, assignments, fallback) =>
  rows.map((row, index) => {
    const fromRule = assignments.get(String(index));
    if (fromRule != null) return { row, categoryId: fromRule, source: "rule" };
    const fallbackId = fallback[bankTransactionType(row.amount)];
    return fallbackId != null
      ? { row, categoryId: fallbackId, source: "fallback" }
      : { row, categoryId: null, source: "none" };
  });

export const clampLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return AUTO_IMPORT_DEFAULT_LIMIT;
  return Math.min(parsed, AUTO_IMPORT_MAX_LIMIT);
};

const importableQuery = (client, connection, { head = false } = {}) => {
  let query = client
    .from("bank_transactions")
    .select(head ? "id" : "id, bank_id, amount, date, description, counterparty", {
      count: "exact",
      head,
    })
    .eq("user_id", connection.user_id)
    .eq("bank_id", connection.bank_id)
    .eq("account_id", connection.account_id)
    .eq("status", "synced")
    .eq("booking_status", "booked");
  if (connection.auto_import_from) {
    query = query.gte("date", connection.auto_import_from);
  }
  return query;
};

const importConnection = async ({ client, connection, limit, categorize }) => {
  const outcome = {
    imported: 0,
    alreadyImported: 0,
    byRule: 0,
    byFallback: 0,
    withoutCategory: 0,
  };

  const { data: wallet, error: walletError } = await client
    .from("Wallet")
    .select("id")
    .eq("id", connection.import_wallet_id)
    .eq("userid", connection.user_id)
    .maybeSingle();
  if (walletError) throw new Error(`Reading the wallet failed: ${walletError.message}`);
  if (!wallet) throw new Error("The target wallet does not belong to the user");

  const { data: rows, error: rowsError } = await importableQuery(client, connection)
    .order("date", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (rowsError) throw new Error(`Reading movements failed: ${rowsError.message}`);
  if (!rows || rows.length === 0) return outcome;

  const { data: categories, error: categoriesError } = await client
    .from("Category")
    .select("id, name, type, active")
    .eq("userid", connection.user_id)
    .eq("active", true);
  if (categoriesError) throw new Error(`Reading categories failed: ${categoriesError.message}`);

  const rules = await loadRules(client, connection.user_id);
  const assignments = categorize(
    rows.map((row, index) => ({
      ref: String(index),
      type: bankTransactionType(row.amount),
      description: row.description,
      counterparty: row.counterparty,
    })),
    { rules, categories: categories ?? [] }
  );

  const resolved = resolveCategories(rows, assignments, findFallbackCategories(categories ?? []));
  const toImport = resolved.filter((item) => item.categoryId != null);
  outcome.withoutCategory = resolved.length - toImport.length;
  outcome.byRule = toImport.filter((item) => item.source === "rule").length;
  outcome.byFallback = toImport.filter((item) => item.source === "fallback").length;

  // Una regola verso la categoria "Trasferimento" (tipo T) fa entrare il movimento come
  // trasferimento da assegnare: serve il tipo della categoria, non solo il suo id.
  const categoryTypeById = new Map((categories ?? []).map((category) => [Number(category.id), category.type]));
  const inserted = await insertImportedTransactions(
    client,
    toImport.map(({ row, categoryId }) =>
      buildAppTransactionFromBank(row, {
        userId: connection.user_id,
        walletId: connection.import_wallet_id,
        categoryId,
        categoryType: categoryTypeById.get(Number(categoryId)),
      })
    )
  );
  await markBankTransactionsImported(
    client,
    connection.user_id,
    toImport.map(({ row }) => row.id)
  );

  outcome.imported = inserted.length;
  outcome.alreadyImported = toImport.length - inserted.length;
  return outcome;
};

/**
 * Esegue un lotto di import automatico su tutte le banche configurate.
 * `remaining` conta i movimenti ancora importabili dopo questo lotto (escluse le banche
 * in errore), cosi' il chiamante sa se richiamare.
 */
export const runAutoImport = async ({
  limit = AUTO_IMPORT_DEFAULT_LIMIT,
  client = supabase,
  categorize = categorizeWithRules,
} = {}) => {
  const summary = {
    connections: 0,
    imported: 0,
    alreadyImported: 0,
    byRule: 0,
    byFallback: 0,
    withoutCategory: 0,
    remaining: 0,
    errors: [],
  };

  const { data: connections, error } = await client
    .from("bank_connections")
    .select("user_id, bank_id, account_id, import_wallet_id, auto_import_from")
    .not("import_wallet_id", "is", null);
  if (error) throw new Error(`Reading bank connections failed: ${error.message}`);

  let budget = clampLimit(limit);
  for (const connection of connections ?? []) {
    summary.connections += 1;
    try {
      if (budget > 0) {
        const outcome = await importConnection({ client, connection, limit: budget, categorize });
        summary.imported += outcome.imported;
        summary.alreadyImported += outcome.alreadyImported;
        summary.byRule += outcome.byRule;
        summary.byFallback += outcome.byFallback;
        summary.withoutCategory += outcome.withoutCategory;
        budget -= outcome.imported + outcome.alreadyImported + outcome.withoutCategory;
        if (outcome.withoutCategory > 0) {
          summary.errors.push({
            bank: connection.bank_id,
            step: "fallback",
            message: "No active 'Altro' category for the movement type",
          });
        }
      }

      const { count, error: countError } = await importableQuery(client, connection, { head: true });
      if (countError) throw new Error(`Counting movements failed: ${countError.message}`);
      // Senza categoria di ripiego quei movimenti resterebbero 'synced' per sempre:
      // non vanno contati come lavoro da rifare, o il chiamante girerebbe a vuoto.
      if (!summary.errors.some((e) => e.bank === connection.bank_id && e.step === "fallback")) {
        summary.remaining += count ?? 0;
      }
    } catch (connectionError) {
      summary.errors.push({ bank: connection.bank_id, step: "import", message: connectionError.message });
    }
  }

  return summary;
};
