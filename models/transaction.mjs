// models/transaction.mjs
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accountId: { type: String, required: true },
    transactionId: { type: String, required: true, unique: true },
    bookingDate: Date,
    valueDate: Date,
    amount: Number,
    currency: String,
    description: String,
    internalTransactionId: String,
    raw: Object, // salva l'intera transazione per backup/analisi
  },
  { timestamps: true }
);

export const Transaction = mongoose.model("Transaction", transactionSchema);
