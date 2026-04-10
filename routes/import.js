import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { importCsvSchema } from "../utils/schemas.js";

const router = express.Router();

function parseCsvLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function detectDelimiter(line) {
  const candidates = [",", ";", "\t", "|"];
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: line.split(delimiter).length - 1,
  }));
  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best.count > 0 ? best.delimiter : ",";
}

function parseCsv(csv) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });

  return { headers, rows };
}

router.post(
  "/csv",
  requireAuth,
  validate(importCsvSchema),
  asyncHandler(async (req, res) => {
    const { csv } = req.body;
    const { headers, rows } = parseCsv(csv);
    const requiredHeaders = ["Type", "Amount", "Date", "Category", "Description"];
    const missingHeaders = requiredHeaders.filter(
      (header) => !headers.includes(header)
    );

    if (missingHeaders.length > 0) {
      return res.status(400).json({
        error: "Invalid CSV format",
        details: `Missing required columns: ${missingHeaders.join(", ")}`,
      });
    }

    const categoryResponse = await supabase
      .from("Category")
      .select("id,name,type")
      .eq("userid", req.user.id);

    if (categoryResponse.error) {
      return res.status(500).json({ error: categoryResponse.error.message });
    }

    const categories = categoryResponse.data || [];
    const categoryMap = new Map(
      categories.map((category) => [
        category.name.trim().toLowerCase(),
        { id: category.id, type: category.type },
      ])
    );

    const walletResponse = await supabase
      .from("Wallet")
      .select("id")
      .eq("userid", req.user.id)
      .eq("is_default", true)
      .single();

    if (walletResponse.error || !walletResponse.data) {
      return res.status(400).json({
        error: "Default wallet is required for import. Please set a default wallet first.",
      });
    }

    const defaultWalletId = walletResponse.data.id;
    const errors = [];
    const transactions = [];

    rows.forEach((row, index) => {
      const rowNum = index + 2;
      const type = String(row.Type ?? "").trim().toUpperCase();
      const amountString = String(row.Amount ?? "").replace(",", ".").trim();
      const dateString = String(row.Date ?? "").trim();
      const categoryName = String(row.Category ?? "").trim();
      const description = String(row.Description ?? "").trim();

      if (!["I", "E"].includes(type)) {
        errors.push(`Row ${rowNum}: Invalid Type "${row.Type}". Must be "I" or "E".`);
        return;
      }

      const amount = parseFloat(amountString);
      if (Number.isNaN(amount)) {
        errors.push(`Row ${rowNum}: Invalid Amount "${row.Amount}".`);
        return;
      }

      const dateParts = dateString.split("/").map((part) => part.trim());
      if (dateParts.length !== 3) {
        errors.push(`Row ${rowNum}: Invalid Date "${row.Date}". Expected format: dd/MM/yyyy.`);
        return;
      }

      const [day, month, year] = dateParts.map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.getDate() !== day ||
        parsedDate.getMonth() !== month - 1 ||
        parsedDate.getFullYear() !== year
      ) {
        errors.push(`Row ${rowNum}: Invalid Date "${row.Date}". Expected format: dd/MM/yyyy.`);
        return;
      }

      if (!categoryName) {
        errors.push(`Row ${rowNum}: Missing Category.`);
        return;
      }

      if (!description) {
        errors.push(`Row ${rowNum}: Description is required.`);
        return;
      }

      const categoryKey = categoryName.toLowerCase();
      const category = categoryMap.get(categoryKey);
      if (!category) {
        errors.push(`Row ${rowNum}: Category "${categoryName}" does not exist.`);
        return;
      }

      if (category.type !== type) {
        errors.push(
          `Row ${rowNum}: Category "${categoryName}" is not valid for type "${type}".`
        );
        return;
      }

      transactions.push({
        userid: req.user.id,
        description,
        note: null,
        amount,
        date: parsedDate.toISOString(),
        type,
        wallet_id: defaultWalletId,
        category_id: category.id,
      });
    });

    if (transactions.length === 0) {
      return res.status(400).json({
        error: "No valid transactions to import.",
        details: errors,
      });
    }

    const { data, error } = await supabase
      .from("Transaction")
      .insert(transactions)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      success: true,
      importedCount: data.length,
      totalRows: rows.length,
      errors,
    });
  })
);

export default router;
