/**
 * Export dei dati di un utente (fase 6 C, 13/11/2026).
 *
 * Due formati:
 *   - `buildUserExport`: un JSON con tutte le tabelle dell'utente, per avere una copia completa
 *     (portabilita', art. 20 GDPR) o per spostare i dati altrove;
 *   - `buildTransactionsCsv`: i movimenti come tabella, da aprire in Excel.
 *
 * Regole:
 *   - ogni query filtra per l'utente del token (colonna `userid`, `user_id` o `id` a seconda della
 *     tabella): il client Supabase usa la service-role key, l'RLS non protegge niente;
 *   - le liste si leggono con `fetchAllRows` (PostgREST tronca a 1000 righe senza dirlo). Se una
 *     lista arriva troncata l'export **fallisce**: una copia incompleta spacciata per completa e'
 *     peggio di un errore;
 *   - restano fuori i segreti e i dati grezzi del fornitore: token di GoCardless (colonne non
 *     selezionate **e** tolte dalla riga, nel caso arrivassero lo stesso), `raw_data` dei movimenti
 *     bancari e del saldo, i codici di reset della password (tabella non letta).
 */
import { supabase as defaultClient } from "../config/supabaseClient.js";
import { fetchAllRows } from "./paginatedSelect.js";

export const EXPORT_FORMAT = "flow-wise-export";
export const EXPORT_VERSION = 1;

/** Colonne di `bank_connections` che si possono esportare: niente token, niente payload grezzi. */
const BANK_CONNECTION_COLUMNS = [
  "id",
  "bank_id",
  "account_id",
  "last_synced",
  "created_at",
  "updated_at",
  "balance_amount",
  "balance_currency",
  "balance_type",
  "balance_reference_date",
  "balance_provider_updated_at",
  "balance_fetched_at",
  "import_wallet_id",
  "auto_import_from",
];

/** Colonne tolte comunque da ogni riga prima di restituirla. */
const ALWAYS_OMIT = new Set([
  "access_token",
  "refresh_token",
  "token_expires_at",
  "raw_data",
  "balance_raw_data",
]);

/**
 * Le sezioni dell'export, nell'ordine in cui compaiono nel JSON.
 * `owner` e' la colonna che lega la riga all'utente; `order` rende stabile la paginazione.
 */
export const EXPORT_SECTIONS = [
  { key: "profile", table: "Profile", owner: "id", order: ["id"] },
  { key: "wallets", table: "Wallet", owner: "userid", order: ["id"] },
  { key: "categories", table: "Category", owner: "userid", order: ["id"] },
  { key: "transactions", table: "Transaction", owner: "userid", order: ["date", "id"] },
  { key: "budgets", table: "Budget", owner: "userid", order: ["id"] },
  { key: "annual_items", table: "annual_items", owner: "user_id", order: ["id"] },
  { key: "annual_installments", table: "annual_installments", owner: "user_id", order: ["due_date", "id"] },
  { key: "category_rules", table: "category_rules", owner: "user_id", order: ["id"] },
  { key: "dashboard_layouts", table: "dashboard_layouts", owner: "user_id", order: ["user_id"] },
  {
    key: "bank_connections",
    table: "bank_connections",
    owner: "user_id",
    order: ["created_at", "id"],
    columns: BANK_CONNECTION_COLUMNS,
  },
  { key: "bank_transactions", table: "bank_transactions", owner: "user_id", order: ["date", "id"] },
];

const stripSecrets = (row) => {
  const clean = {};
  for (const [key, value] of Object.entries(row)) {
    if (!ALWAYS_OMIT.has(key)) clean[key] = value;
  }
  return clean;
};

/** Tutte le righe di una sezione per un utente; errore se PostgREST fallisce o tronca. */
const readSection = async (client, section, userId) => {
  const select = section.columns ? section.columns.join(",") : "*";
  const { rows, truncated } = await fetchAllRows(() => {
    let query = client.from(section.table).select(select).eq(section.owner, userId);
    for (const column of section.order) query = query.order(column, { ascending: true });
    return query;
  });
  if (truncated) {
    throw new Error(`Export incomplete: too many rows in ${section.key}`);
  }
  return rows.map(stripSecrets);
};

/**
 * Export completo di un utente.
 *
 * @param {{id: string, email?: string}} user  l'utente del token (`req.user`)
 * @param {{client?: object, now?: Date}} [options]
 * @returns {Promise<object>} `{ format, version, exported_at, user, counts, data }`
 */
export const buildUserExport = async (user, { client = defaultClient, now = new Date() } = {}) => {
  if (!user?.id) throw new TypeError("buildUserExport: missing user id");

  const data = {};
  const counts = {};
  for (const section of EXPORT_SECTIONS) {
    const rows = await readSection(client, section, user.id);
    data[section.key] = rows;
    counts[section.key] = rows.length;
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: now.toISOString(),
    user: { id: user.id, email: user.email ?? null },
    counts,
    data,
  };
};

// --- CSV dei movimenti -------------------------------------------------------

export const CSV_HEADER = ["Date", "Type", "Amount", "Category", "Wallet", "To wallet", "Description", "Note", "Refund"];

const TYPE_LABEL = { I: "Income", E: "Expense", T: "Transfer" };

/** Un campo CSV con `;` come separatore: tra virgolette solo se serve, virgolette raddoppiate. */
export const csvField = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Importo con la virgola decimale, come lo legge l'Excel italiano: 1234.5 -> "1234,50". */
export const formatAmountIt = (amount) => {
  const n = Math.abs(Number(amount));
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2).replace(".", ",");
};

/**
 * CSV dei movimenti di un utente: separatore `;`, virgola decimale, BOM UTF-8,
 * righe separate da CRLF. L'importo e' sempre positivo: il verso lo dice `Type`
 * (e `Refund` per i rimborsi, che sono entrate con una categoria di spesa).
 *
 * @param {{id: string}} user
 * @param {{client?: object}} [options]
 * @returns {Promise<{csv: string, rows: number}>}
 */
export const buildTransactionsCsv = async (user, { client = defaultClient } = {}) => {
  if (!user?.id) throw new TypeError("buildTransactionsCsv: missing user id");
  const section = (key) => EXPORT_SECTIONS.find((s) => s.key === key);

  const [transactions, categories, wallets] = await Promise.all([
    readSection(client, section("transactions"), user.id),
    readSection(client, section("categories"), user.id),
    readSection(client, section("wallets"), user.id),
  ]);

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const walletName = new Map(wallets.map((w) => [w.id, w.name]));

  const lines = [CSV_HEADER.join(";")];
  for (const t of transactions) {
    lines.push(
      [
        t.date,
        TYPE_LABEL[t.type] ?? t.type,
        formatAmountIt(t.amount),
        categoryName.get(t.category_id) ?? "",
        walletName.get(t.wallet_id) ?? "",
        t.type === "T" ? walletName.get(t.to_wallet_id) ?? "" : "",
        t.description,
        t.note,
        t.is_refund ? "yes" : "",
      ]
        .map(csvField)
        .join(";")
    );
  }

  return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: transactions.length };
};
