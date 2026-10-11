// Cifratura at-rest dei token bancari (bank_connections.access_token / refresh_token).
//
// Perche' esiste: i token OAuth della banca sono credenziali di sola lettura sul conto
// dell'utente. In chiaro sul database sono leggibili da chiunque abbia accesso alla tabella
// (dump, backup, pannello Supabase). Qui vivono SOLO le funzioni di cifratura, cosi' sono
// testabili senza tirare in mezzo il client Supabase.
//
// Algoritmo: AES-256-GCM, chiave derivata con SHA-256 dal segreto applicativo, IV casuale
// per ogni scrittura, tag di autenticazione incluso. Formato del valore memorizzato:
//
//     enc:v1:<iv base64url>.<tag base64url>.<ciphertext base64url>
//
// Il prefisso `enc:v1:` e' l'unico modo per distinguere un valore cifrato da uno in chiaro:
// serve alla migrazione (un valore senza prefisso viene trattato come legacy e riscritto) e
// alla probe di stato del progetto, che conta i token ancora in chiaro.
//
// Chiave: `BANK_TOKEN_ENCRYPTION_KEY` (raccomandata, dedicata). In assenza si ricade su
// `BANK_CLIENT_SECRET` e infine su `SUPABASE_SERVICE_ROLE_KEY`, che e' sempre presente nel
// server. Attenzione: cambiare la chiave rende illeggibili i token gia' cifrati (vanno
// riconnesse le banche), quindi va trattata come un segreto stabile.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const ENCRYPTED_TOKEN_PREFIX = "enc:v1:";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const getKey = () => {
  const secret = [
    process.env.BANK_TOKEN_ENCRYPTION_KEY,
    process.env.BANK_CLIENT_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].find((value) => typeof value === "string" && value.length > 0);

  if (!secret) {
    throw new Error(
      "Chiave di cifratura dei token bancari assente (imposta BANK_TOKEN_ENCRYPTION_KEY)"
    );
  }

  // SHA-256 -> 32 byte, la lunghezza esatta richiesta da aes-256-gcm.
  return createHash("sha256").update(secret).digest();
};

export const isEncryptedToken = (value) =>
  typeof value === "string" && value.startsWith(ENCRYPTED_TOKEN_PREFIX);

/**
 * Cifra un token. `null`/`undefined`/stringa vuota restano `null`; un valore gia' cifrato
 * viene restituito invariato (idempotente, cosi' un secondo salvataggio non ricifra).
 */
export const encryptToken = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return null;
  const value = String(plaintext);
  if (value === "") return null;
  if (isEncryptedToken(value)) return value;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return (
    ENCRYPTED_TOKEN_PREFIX +
    `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`
  );
};

/**
 * Decifra un token. Un valore senza prefisso e' trattato come legacy in chiaro e restituito
 * com'e' (compatibilita' durante/per la migrazione). Un valore malformato o cifrato con
 * un'altra chiave fa fallire la lettura invece di restituire spazzatura.
 */
export const decryptToken = (stored) => {
  if (stored === null || stored === undefined) return null;
  const value = String(stored);
  if (!isEncryptedToken(value)) return value;

  const [ivPart, tagPart, cipherPart, extra] = value
    .slice(ENCRYPTED_TOKEN_PREFIX.length)
    .split(".");

  if (!ivPart || !tagPart || !cipherPart || extra !== undefined) {
    throw new Error("Token cifrato malformato");
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(cipherPart, "base64url");

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || ciphertext.length === 0) {
    throw new Error("Token cifrato malformato");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Impossibile decifrare il token bancario (chiave errata o dato corrotto)"
    );
  }
};
