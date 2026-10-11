import express from "express";
import { supabase as supabaseClient } from "../config/supabaseClient.js";
import { requireAuth as requireAuthMiddleware } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../utils/validate.js";
import { importCsvSchema, transactionCreateSchema } from "../utils/schemas.js";
import { fetchAllRows } from "../utils/paginatedSelect.js";

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

/**
 * Legge l'importo di una riga CSV e lo riporta alla forma canonica
 * `[+-]?\d+(\.\d+)?`, senza interpretare in silenzio separatori ambigui.
 *
 * Regole:
 * - spazi (compreso lo spazio non separabile) rimossi;
 * - con entrambi i separatori presenti (`1.234,56` o `1,234.56`) l'ultimo è
 *   quello decimale e l'altro deve essere un separatore di migliaia a gruppi
 *   di tre cifre; altrimenti la riga è ambigua e viene rifiutata;
 * - con un solo separatore: più occorrenze sono separatori di migliaia, una
 *   sola occorrenza seguita da 1-2 cifre è decimale (`-50,00` -> `-50.00`), una
 *   sola occorrenza seguita da 3 o più cifre (`1,234`) è ambigua e viene
 *   rifiutata: `1,234` può valere 1234 o 1.234 e nessuna delle due letture è
 *   difendibile a naso.
 *
 * Un importo che non si riesce a leggere senza ambiguità non viene mai
 * inventato: `{ ok: false }` fa rifiutare la riga con un errore esplicito.
 *
 * @param {unknown} rawAmount
 * @returns {{ok: true, value: number} | {ok: false, reason: string}}
 */
export function parseAmountValue(rawAmount) {
  const shown = String(rawAmount ?? "").trim();
  if (!shown) {
    return { ok: false, reason: "amount is empty" };
  }

  const text = shown.replace(/[\s\u00a0]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let canonical = text;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    const parts = text.split(decimalSeparator);

    if (parts.length !== 2) {
      return { ok: false, reason: `ambiguous separators in "${shown}"` };
    }

    const [whole, decimals] = parts;
    const groups = whole.split(groupingSeparator);
    const firstGroup = groups[0].replace(/^[+-]/, "");
    const groupingLooksRight =
      /^\d{1,3}$/.test(firstGroup) &&
      groups.slice(1).every((group) => /^\d{3}$/.test(group));

    if (!groupingLooksRight || !/^\d+$/.test(decimals)) {
      return { ok: false, reason: `ambiguous separators in "${shown}"` };
    }

    canonical = `${groups.join("")}.${decimals}`;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const separator = lastComma !== -1 ? "," : ".";
    const groups = text.split(separator);

    if (groups.length > 2) {
      const firstGroup = groups[0].replace(/^[+-]/, "");
      const groupingLooksRight =
        /^\d{1,3}$/.test(firstGroup) &&
        groups.slice(1).every((group) => /^\d{3}$/.test(group));

      if (!groupingLooksRight) {
        return { ok: false, reason: `unrecognised number "${shown}"` };
      }

      canonical = groups.join("");
    } else {
      const [whole, fraction] = groups;
      const signlessWhole = whole.replace(/^[+-]/, "");

      if (!/^\d+$/.test(signlessWhole) || !/^\d+$/.test(fraction)) {
        return { ok: false, reason: `unrecognised number "${shown}"` };
      }

      if (fraction.length > 2) {
        return {
          ok: false,
          reason: `ambiguous separator in "${shown}": 3 or more digits after a single "${separator}" are either a thousands separator or a decimal one, write the amount unambiguously (e.g. 1234.56)`,
        };
      }

      canonical = `${whole}.${fraction}`;
    }
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(canonical)) {
    return { ok: false, reason: `unrecognised number "${shown}"` };
  }

  const value = Number(canonical);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `unrecognised number "${shown}"` };
  }

  return { ok: true, value };
}

/**
 * Convenzione unica sugli importi (vedi `utils/schemas.js` e `utils/amount.js`):
 * `amount` è **sempre >= 0** e il segno lo decide `type` ("I" entrata / "E"
 * spesa). Questa rotta è l'unica che scrive `Transaction` partendo da un CSV
 * scritto a mano o esportato da una banca, quindi è l'unica che può ricevere il
 * segno dentro il valore (`-50,00`).
 *
 * Scelta: un importo negativo significa "uscita" e resta valido solo con un
 * `Type` dichiarato `"E"`; in quel caso viene normalizzato al valore assoluto.
 * Se il segno contraddice il `Type` dichiarato (`Type "I"` con `-50,00`) la riga
 * è ambigua e viene **rifiutata** con un errore esplicito (riga + valore):
 * riscrivere il tipo al posto dell'utente significherebbe girargli una
 * transazione senza dirglielo. Un valore positivo invece non tocca il `Type`:
 * il formato CSV documentato (lato client, `app/settings/import/page.tsx`) scrive
 * gli importi in positivo e usa `Type` per il segno.
 */
export const createImportRouter = ({
  supabase = supabaseClient,
  auth = requireAuthMiddleware,
} = {}) => {
  const router = express.Router();

  router.post(
    "/csv",
    auth,
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

      // La mappa nome->categoria deve essere *completa*: con una `select()` una-shot
      // oltre il tetto PostgREST (1000 righe) le categorie in eccesso mancherebbero
      // dalla mappa e l'import le rifiuterebbe come inesistenti. `.order("id")` e'
      // il tiebreaker univoco che rende le pagine deterministiche.
      let categories;
      try {
        ({ rows: categories } = await fetchAllRows(() =>
          supabase
            .from("Category")
            .select("id,name,type")
            .eq("userid", req.user.id)
            .order("id")
        ));
      } catch (err) {
        // Stesso esito della lettura una-shot fallita: nessuna importazione parziale.
        return res.status(500).json({ error: err.message });
      }

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
        const dateString = String(row.Date ?? "").trim();
        const categoryName = String(row.Category ?? "").trim();
        const description = String(row.Description ?? "").trim();

        if (!["I", "E"].includes(type)) {
          errors.push(`Row ${rowNum}: Invalid Type "${row.Type}". Must be "I" or "E".`);
          return;
        }

        const parsedAmount = parseAmountValue(row.Amount);
        if (!parsedAmount.ok) {
          errors.push(`Row ${rowNum}: Invalid Amount "${row.Amount}" (${parsedAmount.reason}).`);
          return;
        }

        const signedAmount = parsedAmount.value;
        if (signedAmount < 0 && type !== "E") {
          errors.push(
            `Row ${rowNum}: Amount "${row.Amount}" is negative but Type is "${type}". A negative amount means an expense: use Type "E" with the absolute value, or drop the sign.`
          );
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

        const transaction = {
          userid: req.user.id,
          description,
          note: null,
          // Sempre il valore assoluto: il segno vive in `type`.
          amount: Math.abs(signedAmount),
          date: parsedDate.toISOString(),
          type,
          wallet_id: defaultWalletId,
          category_id: category.id,
        };

        // Ultima rete di sicurezza: l'import scrive solo righe che passano lo
        // stesso schema del POST /transaction, quindi il vincolo `amount >= 0`
        // vale qui per costruzione e non solo per come e' scritto il codice sopra.
        // `transactionCreateSchema` e' lo schema del body di POST /transaction e
        // non conosce `userid`: zod rimuove le chiavi sconosciute, quindi il
        // proprietario va riattaccato al payload validato. Senza, la colonna
        // `userid` (default `auth.uid()`, NULL con la service-role key) resterebbe
        // vuota e le righe importate sparirebbero da ogni elenco.
        const validated = transactionCreateSchema.safeParse(transaction);
        if (!validated.success) {
          const detail = validated.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
          errors.push(`Row ${rowNum}: transaction rejected by schema validation (${detail}).`);
          return;
        }

        transactions.push({ ...validated.data, userid: req.user.id });
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

  return router;
};

export default createImportRouter();
