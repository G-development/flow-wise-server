import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { Requisition } from "../models/gocardless.mjs";
import { Transaction } from "../models/transaction.mjs";
import { authMiddleware } from "./authMiddleware.mjs";

dotenv.config();
const FE_URL = process.env.FRONTEND_URL;

const GOCARDLESS_SECRET_ID = process.env.GOCARDLESS_SECRET_ID;
const GOCARDLESS_SECRET_KEY = process.env.GOCARDLESS_SECRET_KEY;

const router = express.Router();

// 1. Get the token
router.post("/token", async (req, res) => {
  try {
    const response = await axios.post(
      "https://bankaccountdata.gocardless.com/api/v2/token/new/",
      {
        secret_id: GOCARDLESS_SECRET_ID,
        secret_key: GOCARDLESS_SECRET_KEY,
      },
      {
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
      }
    );

    res.json(response.data); // { access: "...", access_expires: ..., refresh: "..." }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get the list of institutions (banks)
router.get("/institutions", async (req, res) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  try {
    const response = await axios.get(
      "https://bankaccountdata.gocardless.com/api/v2/institutions/?country=it",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get the agreements (deal to access bank account data)
router.post("/agreement", async (req, res) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  const { institution_id } = req.body;

  try {
    const response = await axios.post(
      "https://bankaccountdata.gocardless.com/api/v2/agreements/enduser/",
      {
        institution_id,
        max_historical_days: "180",
        access_valid_for_days: "30",
        access_scope: ["balances", "details", "transactions"],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Link between user and bank (returns the link to redirect)
router.post("/requisition", async (req, res) => {
  const accessToken = req.headers.authorization?.split(" ")[1];

  const { institution_id, agreement } = req.body;
  console.log(institution_id, agreement);
  if (!institution_id || !agreement) {
    return res
      .status(400)
      .json({ error: "institution_id e agreement_id sono richiesti" });
  }

  try {
    console.log("FE_URL:", FE_URL);

    const response = await axios.post(
      "https://bankaccountdata.gocardless.com/api/v2/requisitions/",
      {
        redirect: `${FE_URL}/settings/yourbank`, // pagina FE
        institution_id,
        //reference: "03052000", // not useful at the moment
        agreement,
        user_language: "IT",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    res.json(response.data); // include requisition_id e link da aprire
  } catch (err) {
    console.log("BE: error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4.1 Salva una requisition nel DB
router.post("/requisition/save", authMiddleware, async (req, res) => {
  try {
    const { requisitionId, institutionId, status, accounts } = req.body;
    const userId = req.user.id;

    if (!requisitionId || !institutionId || !status) {
      return res.status(400).json({ error: "Dati mancanti" });
    }
    const existing = await Requisition.findOne({ requisitionId });
    if (existing) return res.status(200).json(existing);

    const requisition = await Requisition.create({
      userId,
      requisitionId,
      institutionId,
      status,
      accounts,
    });

    res.status(201).json(requisition);
  } catch (err) {
    console.error("Errore nel salvataggio requisition:", err);
    res.status(500).json({ error: "Errore interno del server" });
  }
});

// 4.2 Cerca requisition collegata a user
router.get("/requisition/user", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const requisition = await Requisition.findOne({ userId: userId }).sort({
    createdAt: -1,
  });

  if (!requisition)
    return res.status(200).json({ message: "No requisition found" });

  return res.json({ requisitionId: requisition.requisitionId });
});

// 5. Get requisition details (check if connection works)
router.get("/requisition/:id", async (req, res) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  const { id } = req.params;

  try {
    const response = await axios.get(
      `https://bankaccountdata.gocardless.com/api/v2/requisitions/${id}/`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    res.json(response.data); // contiene account_ids
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get transactions details
router.get("/accounts/:id/transactions", async (req, res) => {
  const accessToken = req.headers.authorization?.split(" ")[1];
  const { id } = req.params;

  try {
    const response = await axios.get(
      `https://bankaccountdata.gocardless.com/api/v2/accounts/${id}/transactions/`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Save transactions in DB
router.post("/transactions/save", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { accountId, transactions } = req.body;

  if (!accountId || !transactions || !transactions.booked) {
    return res
      .status(400)
      .json({ error: "Dati transazioni mancanti o incompleti" });
  }

  let saved = 0;
  let skipped = 0;
  const totalReceived = transactions.booked.length;

  for (const tx of transactions.booked) {
    const exists = await Transaction.findOne({
      transactionId: tx.transactionId,
    });
    if (exists) {
      skipped++;
      continue;
    }

    await Transaction.create({
      userId,
      accountId,
      transactionId: tx.transactionId,
      bookingDate: tx.bookingDate,
      valueDate: tx.valueDate,
      amount: tx.transactionAmount.amount,
      currency: tx.transactionAmount.currency,
      description: tx.remittanceInformationUnstructured,
      internalTransactionId: tx.internalTransactionId,
    });

    saved++;
  }

  const totalInDB = await Transaction.countDocuments({ userId });

  res.status(201).json({
    message: "Transazioni processate",
    received: totalReceived,
    saved,
    skipped,
    totalInDB,
  });
});

export default router;
