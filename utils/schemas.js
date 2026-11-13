import { z } from "zod";

const transactionBaseShape = {
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
  category_id: z.number(),
};

// Entrata o spesa: sempre un wallet, mai una destinazione (vincolo
// `transaction_income_expense_wallets_chk` della migrazione 011).
const incomeExpenseSchema = z.object({
  ...transactionBaseShape,
  type: z.enum(["I", "E"]),
  // Rimborso (fase 5, migrazione 014): un'entrata con una categoria di spesa, che nelle
  // statistiche riduce le spese di quella categoria. Solo per `I` (superRefine sotto).
  is_refund: z.boolean().optional(),
  wallet_id: z.number(),
  to_wallet_id: z.null({ invalid_type_error: "to_wallet_id is only allowed for transfers (type T)" }).optional(),
});

// Trasferimento: `amount` va da `wallet_id` (origine) a `to_wallet_id`
// (destinazione). Un lato può mancare ("da assegnare"), non entrambi, e i due
// lati devono essere diversi (`transaction_transfer_wallets_chk`, migrazione 011).
const transferSchema = z.object({
  ...transactionBaseShape,
  type: z.literal("T"),
  is_refund: z.literal(false, { invalid_type_error: "a transfer cannot be a refund" }).optional(),
  wallet_id: z.number().nullable().optional(),
  to_wallet_id: z.number().nullable().optional(),
});

export const transactionCreateSchema = z
  .discriminatedUnion("type", [incomeExpenseSchema, transferSchema])
  .superRefine((value, ctx) => {
    if (value.type === "E" && value.is_refund === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["is_refund"],
        message: "only an income (type I) can be a refund",
      });
    }
    if (value.type !== "T") return;
    const from = value.wallet_id ?? null;
    const to = value.to_wallet_id ?? null;
    if (from == null && to == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wallet_id"],
        message: "a transfer needs at least one side: wallet_id (from) or to_wallet_id (to)",
      });
    } else if (from === to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to_wallet_id"],
        message: "a transfer must move money between two different wallets",
      });
    }
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

// Un wallet è un conto (default) o un salvadanaio di un conto (migrazione 012): il
// salvadanaio vuole il conto padre, un conto non ne ha. Che il padre sia un conto
// dell'utente lo controlla il database (45005).
export const walletCreateSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    kind: z.enum(["account", "pot"]).optional(),
    parent_wallet_id: z.number().int().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const isPot = value.kind === "pot";
    if (isPot && value.parent_wallet_id == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parent_wallet_id"], message: "a savings pot needs its account (parent_wallet_id)" });
    }
    if (!isPot && value.parent_wallet_id != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parent_wallet_id"], message: "only a savings pot (kind pot) has a parent account" });
    }
  });

export const walletUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.boolean().optional(),
  // Saldo di apertura del wallet, in centesimi interi (come la somma in
  // utils/walletService.js). È il punto di partenza del saldo derivato, non
  // un saldo finale: il segno è ammesso (un wallet può nascere in negativo).
  opening_balance_cents: z
    .number({ invalid_type_error: "opening_balance_cents must be a number" })
    .int("opening_balance_cents must be an integer number of cents")
    .optional(),
  // Tetto del salvadanaio (migrazione 013): fisso in centesimi, oppure calcolato dal piano.
  cap_cents: z.number().int().positive().nullable().optional(),
  cap_from_plan: z.boolean().optional(),
});

// Piano delle spese annuali (migrazione 013). Importi in centesimi interi, date YYYY-MM-DD.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
export const annualInstallmentSchema = z.object({
  due_date: isoDate,
  amount_cents: z.number().int().positive("amount_cents must be a positive integer number of cents"),
});
// `is_paid` (migrazione 015): rata segnata pagata a mano, anche senza collegare un movimento.
export const annualInstallmentUpdateSchema = annualInstallmentSchema.partial().extend({ is_paid: z.boolean().optional() });
export const annualItemCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  pot_wallet_id: z.number().int(),
  note: z.string().nullable().optional(),
  installments: z.array(annualInstallmentSchema).optional(),
});
export const annualItemUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  note: z.string().nullable().optional(),
  active: z.boolean().optional(),
  pot_wallet_id: z.number().int().optional(),
});
export const annualPaymentSchema = z.object({
  transaction_id: z.number().int().nullable(),
});

export const importCsvSchema = z.object({
  csv: z.string().min(1, "CSV content is required"),
});

export const userRegisterSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("invalid email"),
  password: z.string().min(6, "password too short"),
});

// Import automatico per una banca collegata (PUT /bank/connections/:bank/auto-import).
// `walletId: null` lo disattiva. `fromDate` e' la data da cui prendere i movimenti:
// evita di reimportare quelli piu' vecchi gia' inseriti prima del collegamento.
export const bankAutoImportSchema = z.object({
  walletId: z
    .number({ invalid_type_error: "walletId must be a number or null" })
    .int()
    .positive()
    .nullable(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "fromDate must be YYYY-MM-DD")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "fromDate is not a valid date")
    .nullable()
    .optional(),
});

/** DELETE /users/me: la propria email, scritta per conferma (R4, 13/11/2026). */
export const accountDeleteSchema = z.object({
  confirmEmail: z.string().trim().min(1, "Type your email to confirm"),
});
