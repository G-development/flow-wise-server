/**
 * Migrazione one-shot: cifra at-rest i token gia' presenti in `bank_connections`.
 *
 * Perche' esiste: `saveBankConnection` ora cifra `access_token` e `refresh_token` con
 * AES-256-GCM (`utils/bankTokenCrypto.js`), ma le righe scritte prima di quel fix restano in
 * chiaro sul database. Questo script le riscrive cifrate. E' idempotente: un valore gia'
 * cifrato (prefisso `enc:v1:`) viene saltato, un valore in chiaro viene cifrato.
 *
 * Non stampa mai il valore di un token: solo quanti byte e se era cifrato o in chiaro.
 *
 * Uso, dalla root del repo server:
 *     node migrate-bank-tokens.mjs            # dry-run: mostra cosa verrebbe cifrato
 *     node migrate-bank-tokens.mjs --apply    # scrive e verifica
 *
 * Richiede `BANK_TOKEN_ENCRYPTION_KEY` (o `BANK_CLIENT_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`)
 * nello stesso `.env` con cui gira il server: la decifratura futura usa quella chiave.
 */

import { supabase } from "./config/supabaseClient.js";
import {
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "./utils/bankTokenCrypto.js";

const apply = process.argv.includes("--apply");

const isPlaintext = (value) =>
  typeof value === "string" && value !== "" && !isEncryptedToken(value);

const { data, error } = await supabase
  .from("bank_connections")
  .select("id, bank_id, account_id, access_token, refresh_token");

if (error) throw new Error(error.message);

const rows = data ?? [];

const plan = rows.map((row) => ({
  id: row.id,
  bankId: row.bank_id,
  accessPlaintext: isPlaintext(row.access_token),
  refreshPlaintext: isPlaintext(row.refresh_token),
  accessLength: (row.access_token ?? "").length,
  refreshLength: (row.refresh_token ?? "").length,
}));

console.log(`bank_connections: ${plan.length} righe`);
for (const row of plan) {
  const state = [
    row.accessPlaintext ? "access IN CHIARO" : "access ok",
    row.refreshPlaintext ? "refresh IN CHIARO" : "refresh ok",
  ].join(", ");
  console.log(
    `  ${String(row.bankId).padEnd(34)} ${state} (len ${row.accessLength}/${row.refreshLength})`
  );
}

const toWrite = plan.filter((row) => row.accessPlaintext || row.refreshPlaintext);

if (!apply) {
  console.log(
    `\nDRY-RUN: ${toWrite.length} righe da cifrare su ${plan.length}. Rilancia con --apply per scrivere.`
  );
  process.exit(0);
}

let touched = 0;
for (const row of toWrite) {
  // Rilettura difensiva: si cifra il valore attuale, non quello del piano.
  const { data: current, error: readError } = await supabase
    .from("bank_connections")
    .select("access_token, refresh_token")
    .eq("id", row.id)
    .single();

  if (readError) throw new Error(`bank_connections ${row.id}: ${readError.message}`);

  const update = {};
  if (isPlaintext(current.access_token)) {
    // decryptToken e' un passthrough sui valori in chiaro: cifra solo cio' che serve.
    update.access_token = encryptToken(decryptToken(current.access_token));
  }
  if (isPlaintext(current.refresh_token)) {
    update.refresh_token = encryptToken(decryptToken(current.refresh_token));
  }
  if (Object.keys(update).length === 0) continue;

  const { error: writeError } = await supabase
    .from("bank_connections")
    .update(update)
    .eq("id", row.id);

  if (writeError) throw new Error(`bank_connections ${row.id}: ${writeError.message}`);
  touched += 1;
  console.log(`  cifrata ${row.bankId} (${row.id})`);
}

// Verifica sul DB, non sul piano.
const { data: after, error: afterError } = await supabase
  .from("bank_connections")
  .select("access_token, refresh_token");

if (afterError) throw new Error(afterError.message);

const stillPlaintext = (after ?? []).filter(
  (row) => isPlaintext(row.access_token) || isPlaintext(row.refresh_token)
).length;

console.log(
  `\nRighe cifrate: ${touched}. Token ancora in chiaro: ${stillPlaintext}.`
);
process.exit(stillPlaintext === 0 ? 0 : 1);
