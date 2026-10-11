import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { requireAuth } from "../config/auth-middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getWalletsWithBalances } from "../utils/walletService.js";
import { validate } from "../utils/validate.js";
import { walletCreateSchema, walletUpdateSchema } from "../utils/schemas.js";

const router = express.Router();

// Tutte le risposte di questo router che riguardano il saldo usano la stessa forma:
// il `balance` restituito è quello DERIVATO dalle transazioni a partire da
// `opening_balance_cents` (utils/walletService.js). La colonna `Wallet.balance` è
// stata rimossa da `migrations/005_drop_wallet_balance.sql` e non va più né scritta
// né letta: la stessa risorsa non deve avere due definizioni di saldo.
//
// Gli invarianti di `Wallet` — massimo 3 per utente, esattamente un default per
// utente che possiede wallet — sono del DB (`migrations/004_wallet_invariants.sql`,
// trigger e indice unico parziale). Questo router NON li ricontrolla: esegue la
// scrittura e traduce l'errore che il DB solleva. Il vecchio `select count(*)` +
// `insert` non era atomico (due POST paralleli creavano il quarto wallet) e la
// vecchia coppia di UPDATE del cambio di default poteva lasciare l'utente senza.

/**
 * Contratto d'errore del DB per `Wallet` (`migrations/004_wallet_invariants.sql`).
 *
 * PostgREST mette lo SQLSTATE in `error.code` e il nome dell'eccezione in
 * `error.message`; il messaggio del DB non va mai rimandato al client (è testo
 * interno, non parte del contratto pubblico). Qui c'è la traduzione:
 *
 *   45001  wallet_limit_exceeded   quarto wallet per l'utente            -> 409
 *   45002  wallet_default_missing  commit senza default per l'utente      -> 409
 *   45003  wallet_not_found        RPC su wallet inesistente o altrui     -> 404
 */
const WALLET_DB_ERRORS = {
  45001: { status: 409, error: "Max 3 wallets allowed per user" },
  45002: {
    status: 409,
    error: "A wallet-owning user must always keep exactly one default wallet",
  },
  45003: { status: 404, error: "Wallet not found" },
};

/**
 * Nome dell'eccezione -> SQLSTATE: rete di sicurezza per una versione di PostgREST
 * che non propagasse `error.code`. Nella 004 il messaggio dell'eccezione *è*
 * l'identificatore (`wallet_limit_exceeded`, ...), quindi la corrispondenza non è
 * fragile.
 */
const WALLET_DB_ERROR_NAMES = {
  wallet_limit_exceeded: 45001,
  wallet_default_missing: 45002,
  wallet_not_found: 45003,
};

/**
 * Traduce un errore di scrittura su `Wallet` nella risposta HTTP.
 *
 * Un errore non previsto resta `400` con il messaggio del DB, come prima di questa
 * modifica (è la convenzione di tutte le route del server). L'unica eccezione è la
 * funzione RPC assente: lì l'errore è di ambiente — la 004 non è applicata — non di
 * richiesta, e nasconderlo dentro un 400 renderebbe il guasto illeggibile.
 */
const respondWalletWriteError = (res, error) => {
  const code = error?.code ?? WALLET_DB_ERROR_NAMES[error?.message];
  const mapped = WALLET_DB_ERRORS[code];
  if (mapped) return res.status(mapped.status).json({ error: mapped.error });

  if (error?.code === "PGRST202") {
    return res.status(503).json({
      error:
        "Moving the default wallet is unavailable: migrations/004_wallet_invariants.sql has not been applied",
    });
  }

  return res.status(400).json({ error: error.message });
};

// GET /wallet - tutti i wallet dell'utente, con il saldo derivato dalle transazioni
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const wallets = await getWalletsWithBalances(req.user.id);
    res.status(200).json(wallets);
  })
);

// POST /wallet - crea un nuovo wallet
router.post(
  "/",
  requireAuth,
  validate(walletCreateSchema),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Missing wallet name" });

    // Nessun conteggio preventivo: il limite di 3 wallet è un invariante del DB
    // (trigger `wallet_before_write_trg`, serializzato da un advisory lock per
    // utente), quindi o l'insert riesce o fallisce con 45001 -> 409.
    //
    // `is_default` non si manda: lo decide il DB. Il primo wallet dell'utente
    // nasce default (trigger BEFORE INSERT) anche se il chiamante chiedesse il
    // contrario, e un `true` su un utente che ha già un default viene riportato a
    // false. Nessun `balance` scritto: la colonna non esiste più (migrazione 005)
    // e non era comunque la fonte del saldo. `.select("id")` è ciò che rende `data`
    // non nullo (prima l'insert senza select restituiva `data: null`).
    const { data, error } = await supabase
      .from("Wallet")
      .insert([{ name, userid: req.user.id }])
      .select("id")
      .single();

    if (error) return respondWalletWriteError(res, error);

    // Stessa forma di GET /wallet (saldo derivato), non la riga appena inserita.
    const wallets = await getWalletsWithBalances(req.user.id);
    const wallet = wallets.find((item) => String(item.id) === String(data.id));
    res.status(201).json(wallet ?? data);
  })
);

// PUT /wallets/:id - aggiorna nome, flag di default o saldo di apertura.
// Il saldo finale non è modificabile: è derivato dalle transazioni, che partono
// da `opening_balance_cents` (utils/walletService.js).
router.put(
  "/:id",
  requireAuth,
  validate(walletUpdateSchema),
  asyncHandler(async (req, res) => {
    const { name, is_default, opening_balance_cents } = req.body;
    const { id } = req.params;

    // Il cambio di default è la RPC `wallet_set_default` (migrazione 004): una sola
    // operazione, che azzera gli altri default dell'utente e setta questo nella
    // stessa transazione. Due UPDATE separati non sono più possibili: il primo
    // committava con zero default e veniva respinto (45002), senza alcun modo di
    // annullare l'effetto del secondo.
    const switchingDefault = is_default === true;

    const updates = {};
    if (name !== undefined) updates.name = name;
    // `is_default: false` resta un UPDATE normale: è il DB a rifiutare il commit se
    // spegne l'ultimo default dell'utente (45002 -> 409).
    if (is_default !== undefined && !switchingDefault)
      updates.is_default = is_default;
    if (opening_balance_cents !== undefined)
      updates.opening_balance_cents = opening_balance_cents;

    if (switchingDefault) {
      const { data: moved, error } = await supabase.rpc("wallet_set_default", {
        p_userid: req.user.id,
        // Il parametro è `integer`: `Number` anche per un id non numerico, così il
        // DB lo vede come "non trovato" (45003 -> 404) invece che come errore di tipo.
        p_wallet_id: Number(id),
      });

      if (error) return respondWalletWriteError(res, error);
      if (!moved?.length) return res.status(404).json({ error: "Wallet not found" });
    }

    // Le modifiche restanti (nome, saldo di apertura) restano un UPDATE separato:
    // sono già state applicate insieme al default, quindi un loro errore non tocca
    // l'invariante. Un cambio di default riuscito non viene annullato.
    if (Object.keys(updates).length > 0) {
      // `.select("id")` e non `.select()`: la riga grezza non deve tornare al client.
      const { error } = await supabase
        .from("Wallet")
        .update(updates)
        .eq("id", id)
        .eq("userid", req.user.id)
        .select("id")
        .single();

      if (error) return respondWalletWriteError(res, error);
    }

    // Stessa forma di GET /wallet: `balance` è quello derivato, mai la colonna.
    const wallets = await getWalletsWithBalances(req.user.id);
    const wallet = wallets.find((item) => String(item.id) === String(id));
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });
    res.status(200).json(wallet);
  })
);

// DELETE /wallet/:id - elimina un wallet
// Eliminare il wallet di default è lecito: il DB ne promuove un altro (trigger
// `wallet_after_delete_trg`), quindi da qui non serve nessun codice aggiuntivo.
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // `.select("id")` rende `data` un array: senza, `data` è `null` e `data[0]`
    // faceva esplodere la risposta con un 500.
    const { data, error } = await supabase
      .from("Wallet")
      .delete()
      .eq("id", id)
      .eq("userid", req.user.id)
      .select("id");

    if (error) return res.status(400).json({ error: error.message });
    res
      .status(200)
      .json({ message: "Wallet deleted", wallet: data?.[0] ?? null });
  })
);

export default router;
