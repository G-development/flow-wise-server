import { z } from "zod";

export const transactionCreateSchema = z.object({
  description: z.string().min(1, "description is required"),
  note: z.string().optional().nullable(),
  amount: z.number({ invalid_type_error: "amount must be a number" }),
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
  balance: z.number().optional(),
  is_default: z.boolean().optional(),
});

export const userRegisterSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("invalid email"),
  password: z.string().min(6, "password too short"),
});
