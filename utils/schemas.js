import { z } from "zod";

export const transactionCreateSchema = z.object({
  description: z.string().min(1, "description is required"),
  note: z.string().optional().nullable(),
  // Convenzione unica del progetto: `amount` è sempre >= 0, il segno lo decide
  // `type` ("I" entrata / "E" spesa). Lo zero è ammesso: non è una questione di
  // segno e il percorso di import lo usa già per derivare il tipo (>= 0 -> "I").
  // Chi legge non deve interpretare il segno dal numero: usare `type`.
  amount: z
    .number({ invalid_type_error: "amount must be a number" })
    .nonnegative({
      message:
        'amount must not be negative: enter the absolute value and use type ("I" for income, "E" for expense) to express the sign',
    }),
  date: z.string().min(1, "date is required"),
  type: z.enum(["I", "E"]),
  wallet_id: z.number(),
  category_id: z.number(),
});

export const transactionUpdateSchema = transactionCreateSchema; // same shape expected by current code

export const categoryCreateSchema = z.object({
  name: z.string().min(1, "name is required"),
  type: z.enum(["I", "E"]),
});

export const categoryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["I", "E"]).optional(),
  active: z.boolean().optional(),
});

export const walletCreateSchema = z.object({
  name: z.string().min(1, "name is required"),
});

export const walletUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.boolean().optional(),
  // Saldo di apertura del wallet, in centesimi interi (come la somma in
  // services/walletService.js). È il punto di partenza del saldo derivato, non
  // un saldo finale: il segno è ammesso (un wallet può nascere in negativo).
  opening_balance_cents: z
    .number({ invalid_type_error: "opening_balance_cents must be a number" })
    .int("opening_balance_cents must be an integer number of cents")
    .optional(),
});

export const importCsvSchema = z.object({
  csv: z.string().min(1, "CSV content is required"),
});

export const userRegisterSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("invalid email"),
  password: z.string().min(6, "password too short"),
});
