/**
 * Regressione — il saldo di `Wallet` ha una sola definizione: quella **derivata**
 * dalle transazioni a partire da `opening_balance_cents` (`utils/walletService.js`).
 *
 * La colonna `Wallet.balance` è stata rimossa da
 * `migrations/005_drop_wallet_balance.sql` e non va più né scritta né letta. Questo
 * file impedisce che rientri, su tre fronti indipendenti:
 *
 *   1. il wallet di prova porta un saldo **memorizzato** diverso da quello derivato
 *      (4000.00 contro 50.00): se una route tornasse la colonna, il numero sarebbe
 *      sbagliato *e* plausibile — il caso peggiore;
 *   2. `PUT /wallet/:id` deve restituire lo **stesso saldo e la stessa forma** di
 *      `GET /wallet` (campo `balance`, tipo numero), non la riga grezza;
 *   3. `POST`/`PUT` non devono **scrivere** `balance`: il fake, con lo schema di
 *      `Wallet` dichiarato (`columns`), rifiuta la scrittura come il PostgREST reale
 *      dopo la 005 (`PGRST204`), quindi reintrodurre `balance: 0` rende il POST
 *      rosso invece di passare in silenzio.
 *
 * End-to-end: app Express vera, router vero, `requireAuth` vero, client
 * `@supabase/supabase-js` vero; finto solo il server Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const TOKEN1 = "token-user-1";

const WALLET_ID = 7;

/** Saldo memorizzato nella colonna fantasma: volutamente diverso dal derivato. */
const STORED_BALANCE = 4000;

/**
 * Movimenti del wallet di prova: 5 entrate da 10.00, apertura 0 -> derivato 50.00.
 * Ben diverso dai 4000.00 memorizzati: un test che leggesse la colonna lo vedrebbe.
 */
const incomeRows = () =>
  Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    userid: U1,
    wallet_id: WALLET_ID,
    description: `entrata ${i}`,
    amount: 10,
    type: "I",
    date: "2026-01-01",
  }));

const DERIVED_BALANCE = 50;

/**
 * Il wallet di prova porta la colonna fantasma `balance` con un valore stale: è la
 * trappola. Lo schema di `Wallet` NON la include, quindi le scritture che la
 * contengono sono respinte (come dopo la 005), mentre la riga già presente la
 * conserva — esattamente lo stato che la regressione deve saper riconoscere.
 */
const walletWithStoredBalance = () => ({
  id: WALLET_ID,
  userid: U1,
  name: "Main",
  is_default: true,
  opening_balance_cents: 0,
  balance: STORED_BALANCE,
});

const columns = {
  // Schema reale dopo la 005: `balance` non c'è.
  Wallet: ["id", "userid", "name", "is_default", "opening_balance_cents"],
};

const fake = await startFakeSupabase({
  users: { [TOKEN1]: { id: U1, email: "user1@example.com" } },
  tables: { Wallet: [walletWithStoredBalance()], Transaction: incomeRows() },
  columnDefaults: { Wallet: { opening_balance_cents: 0, is_default: false } },
  walletInvariants: true,
  columns,
});

// L'env va impostato PRIMA dell'import: `config/supabaseClient.js` costruisce il
// client all'import (e `dotenv` non sovrascrive variabili già presenti).
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const express = (await import("express")).default;
const walletRouter = (await import("./wallet.js")).default;

const app = express();
app.use(express.json());
app.use("/wallet", walletRouter);
app.use((err, req, res, next) => {
  void next;
  res.status(500).json({ error: "Internal Server Error" });
});

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  return fake.close();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const request = async (method, path, { token = TOKEN1, body } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/** Riporta lo store allo stato iniziale e azzera il registro delle richieste. */
const reset = () => {
  fake.state.store.Wallet = [walletWithStoredBalance()];
  fake.state.store.Transaction = incomeRows();
  fake.state.requests.length = 0;
};

/** Le richieste PostgREST ricevute dal fake, con metodo e payload inviato. */
const restRequests = () => fake.restRequests();

const walletRow = (id = WALLET_ID) =>
  fake.state.store.Wallet.find((row) => String(row.id) === String(id));

const walletCount = () =>
  fake.state.store.Wallet.filter((row) => row.userid === U1).length;

// ---------------------------------------------------------------------------
// La premessa: il wallet di prova ha davvero stored != derived
// ---------------------------------------------------------------------------

test("premessa: il saldo memorizzato (4000) è diverso da quello derivato (50)", async () => {
  reset();

  const { status, body } = await request("GET", "/wallet");
  assert.equal(status, 200);
  assert.equal(body.length, 1);

  assert.equal(
    walletRow().balance,
    STORED_BALANCE,
    "la colonna fantasma è ancora nella riga (è la trappola da riconoscere)"
  );
  assert.equal(
    body[0].balance,
    DERIVED_BALANCE,
    "GET /wallet espone il saldo derivato, non la colonna"
  );
  assert.notEqual(body[0].balance, walletRow().balance);
});

// ---------------------------------------------------------------------------
// 1. PUT restituisce il saldo derivato, identico a GET
// ---------------------------------------------------------------------------

test("PUT /wallet/:id restituisce il saldo derivato, non quello memorizzato", async () => {
  reset();

  const before = await request("GET", "/wallet");
  assert.equal(before.body[0].balance, DERIVED_BALANCE);

  const { status, body } = await request("PUT", `/wallet/${WALLET_ID}`, {
    body: { name: "Rinominato" },
  });

  assert.equal(status, 200);
  assert.equal(body.name, "Rinominato");
  assert.equal(
    body.balance,
    DERIVED_BALANCE,
    "il PUT restituisce il saldo derivato dalle transazioni"
  );
  assert.equal(
    body.balance,
    before.body[0].balance,
    "PUT e GET restituiscono lo stesso saldo"
  );
  assert.notEqual(
    body.balance,
    STORED_BALANCE,
    "il saldo memorizzato nella colonna non compare nella risposta"
  );
});

test("l'apertura aggiornata entra nel saldo: PUT resta d'accordo con GET", async () => {
  reset();

  // 10000 centesimi = 100.00 di apertura, più i 50.00 di movimenti -> 150.00.
  const { status, body } = await request("PUT", `/wallet/${WALLET_ID}`, {
    body: { opening_balance_cents: 10000 },
  });

  assert.equal(status, 200);
  assert.equal(body.opening_balance_cents, 10000);
  assert.equal(body.balance, 150, "apertura + movimenti, non la colonna");

  const after = await request("GET", "/wallet");
  assert.equal(after.body[0].balance, body.balance);
  assert.notEqual(body.balance, STORED_BALANCE);
});

test("PUT e GET espongono il saldo con la stessa forma (stesso nome, stesso tipo)", async () => {
  reset();

  const get = await request("GET", "/wallet");
  const put = await request("PUT", `/wallet/${WALLET_ID}`, {
    body: { name: "Rinominato" },
  });

  const getWallet = get.body[0];
  const putWallet = put.body;

  // Stessa forma della risorsa: le due risposte sono lo stesso read model.
  assert.deepEqual(
    Object.keys(putWallet).sort(),
    Object.keys(getWallet).sort(),
    "PUT e GET espongono la stessa forma della risorsa"
  );

  // Stesso nome e stesso tipo per il campo saldo.
  assert.ok(
    Object.prototype.hasOwnProperty.call(putWallet, "balance"),
    "il campo saldo si chiama `balance`, come in GET"
  );
  assert.equal(typeof putWallet.balance, "number");
  assert.equal(typeof putWallet.balance, typeof getWallet.balance);
  assert.equal(putWallet.balance, getWallet.balance);

  // Nessun secondo campo di saldo con un altro nome (es. `balance_cents`).
  const saldoKeys = (wallet) =>
    Object.keys(wallet)
      .filter((key) => /^balance/.test(key))
      .sort();
  assert.deepEqual(
    saldoKeys(putWallet),
    ["balance"],
    "l'unico campo di saldo è `balance` (l'apertura è `opening_balance_cents`)"
  );
  assert.deepEqual(saldoKeys(putWallet), saldoKeys(getWallet));
  assert.equal(
    putWallet.balance_cents,
    undefined,
    "nessuna forma alternativa del saldo"
  );
});

// ---------------------------------------------------------------------------
// 2. POST/PUT non scrivono la colonna `balance`
// ---------------------------------------------------------------------------

test("POST /wallet non scrive nulla nella colonna `balance`", async () => {
  reset();

  const { status, body } = await request("POST", "/wallet", {
    body: { name: "Nuovo" },
  });

  assert.equal(status, 201, "senza scrittura sulla colonna rimossa l'insert riesce");

  const insert = restRequests().find(
    (request) => request.method === "POST" && request.path === "/rest/v1/Wallet"
  );
  assert.ok(insert, "il POST deve essere arrivato a PostgREST");
  assert.deepEqual(
    insert.body,
    [{ name: "Nuovo", userid: U1 }],
    "il payload non contiene `balance` (né alcuna colonna assente)"
  );

  const created = walletRow(body.id);
  assert.ok(created, "il wallet è stato creato");
  assert.equal(
    Object.prototype.hasOwnProperty.call(created, "balance"),
    false,
    "la riga creata non porta alcun valore di `balance`"
  );
});

test("PUT /wallet/:id non scrive nulla nella colonna `balance`", async () => {
  reset();

  const { status } = await request("PUT", `/wallet/${WALLET_ID}`, {
    body: { name: "Rinominato", opening_balance_cents: 10000 },
  });

  assert.equal(status, 200);

  const update = restRequests().find(
    (request) => request.method === "PATCH" && request.path === "/rest/v1/Wallet"
  );
  assert.ok(update, "l'update deve essere arrivato a PostgREST");
  assert.deepEqual(
    update.body,
    { name: "Rinominato", opening_balance_cents: 10000 },
    "il payload dell'update non contiene `balance`"
  );

  // La colonna memorizzata resta quella iniziale: nessuno l'ha toccata.
  assert.equal(walletRow().balance, STORED_BALANCE);
});

// ---------------------------------------------------------------------------
// 3. La difesa è attiva: il fake rifiuta la colonna rimossa come il DB reale
// ---------------------------------------------------------------------------

test("il fake riproduce il DB post-005: una scrittura su `balance` è respinta (PGRST204)", async () => {
  reset();
  const before = walletCount();

  // Prova diretta su PostgREST, senza passare dalla route: è ciò che accadrebbe se
  // qualcuno reintroducesse `balance: 0` nell'insert di `POST /wallet`.
  const response = await fetch(`${fake.url}/rest/v1/Wallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ name: "Probe", userid: U1, balance: 0 }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, "PGRST204");
  assert.match(
    payload.message,
    /Could not find the 'balance' column of 'Wallet' in the schema cache/
  );

  assert.equal(walletCount(), before, "la scrittura respinta non crea righe");
});

test("se il POST reintroducesse `balance: 0`, fallirebbe invece di passare in silenzio", async () => {
  reset();

  // Stessa scrittura della route corretta, ma con la colonna fantasma reintrodotta:
  // è il payload che `routes/wallet.js` mandava prima della 005. Il fake lo rifiuta,
  // quindi il POST non può più rispondere 201 senza che nessuno se ne accorga.
  const response = await fetch(`${fake.url}/rest/v1/Wallet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify([{ name: "Fantasma", userid: U1, balance: 0 }]),
  });

  assert.equal(
    response.status,
    400,
    "una scrittura sulla colonna rimossa non deve riuscire"
  );
  assert.equal((await response.json()).code, "PGRST204");

  // Controprova: senza `balance` lo stesso insert passa. La difesa non è un rifiuto
  // generalizzato delle scritture su `Wallet`.
  const ok = await request("POST", "/wallet", { body: { name: "Legittimo" } });
  assert.equal(ok.status, 201);
});
