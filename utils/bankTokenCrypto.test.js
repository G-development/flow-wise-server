import test from "node:test";
import assert from "node:assert/strict";

import {
  ENCRYPTED_TOKEN_PREFIX,
  decryptToken,
  encryptToken,
  isEncryptedToken,
} from "./bankTokenCrypto.js";

// La chiave viene letta a ogni chiamata: questi test possono manipolarla senza reimport.
const withKey = (key) => {
  const previous = process.env.BANK_TOKEN_ENCRYPTION_KEY;
  process.env.BANK_TOKEN_ENCRYPTION_KEY = key;
  return () => {
    if (previous === undefined) delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
    else process.env.BANK_TOKEN_ENCRYPTION_KEY = previous;
  };
};

test("round-trip: il token cifrato non contiene il chiaro e si rilegge", () => {
  const restore = withKey("test-key-1");
  try {
    const plaintext = "gc_access_token_1234567890";
    const stored = encryptToken(plaintext);

    assert.equal(isEncryptedToken(stored), true);
    assert.ok(stored.startsWith(ENCRYPTED_TOKEN_PREFIX));
    assert.ok(!stored.includes(plaintext), "il valore memorizzato non deve contenere il token");
    assert.equal(decryptToken(stored), plaintext);
  } finally {
    restore();
  }
});

test("due cifrature dello stesso token differiscono (IV casuale) ma decifrano uguale", () => {
  const restore = withKey("test-key-1");
  try {
    const a = encryptToken("same");
    const b = encryptToken("same");
    assert.notEqual(a, b);
    assert.equal(decryptToken(a), "same");
    assert.equal(decryptToken(b), "same");
  } finally {
    restore();
  }
});

test("cifrare un valore gia' cifrato e' idempotente", () => {
  const restore = withKey("test-key-1");
  try {
    const once = encryptToken("token");
    assert.equal(encryptToken(once), once);
  } finally {
    restore();
  }
});

test("null, undefined e stringa vuota restano null (nessun valore da proteggere)", () => {
  const restore = withKey("test-key-1");
  try {
    assert.equal(encryptToken(null), null);
    assert.equal(encryptToken(undefined), null);
    assert.equal(encryptToken(""), null);
    assert.equal(decryptToken(null), null);
    assert.equal(decryptToken(undefined), null);
  } finally {
    restore();
  }
});

test("un valore legacy in chiaro viene restituito com'e' da decryptToken", () => {
  const restore = withKey("test-key-1");
  try {
    assert.equal(isEncryptedToken("plain_legacy_token"), false);
    assert.equal(decryptToken("plain_legacy_token"), "plain_legacy_token");
  } finally {
    restore();
  }
});

test("un token manomesso non decifra: errore invece di spazzatura", () => {
  const restore = withKey("test-key-1");
  try {
    const stored = encryptToken("token-da-proteggere");
    // Si manomette il PRIMO carattere dell'IV, non l'ultimo del payload: l'ultimo
    // carattere base64 di un gruppo finale puo' trasportare solo bit di padding
    // (es. 'A' -> 'B' e' invisibile se i bit dati sono '00'), quindi la manomissione
    // non cambierebbe i byte decodificati e la decifratura riuscirebbe. L'IV e' 12 byte
    // = 16 caratteri base64url tutti significativi: alterarne uno cambia sempre la
    // keystream e il tag GCM non verifica mai.
    const i = ENCRYPTED_TOKEN_PREFIX.length;
    const tampered =
      stored.slice(0, i) + (stored[i] === "A" ? "B" : "A") + stored.slice(i + 1);

    assert.throws(() => decryptToken(tampered), /decifrare|malformato/i);
  } finally {
    restore();
  }
});

test("un token cifrato con un'altra chiave non e' leggibile con la chiave corrente", () => {
  let stored;
  const restoreA = withKey("chiave-A");
  try {
    stored = encryptToken("token-di-A");
  } finally {
    restoreA();
  }

  const restoreB = withKey("chiave-B");
  try {
    assert.throws(() => decryptToken(stored), /decifrare/i);
  } finally {
    restoreB();
  }
});

test("senza alcuna chiave configurata la cifratura fallisce esplicitamente", () => {
  const previous = {
    key: process.env.BANK_TOKEN_ENCRYPTION_KEY,
    client: process.env.BANK_CLIENT_SECRET,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
  delete process.env.BANK_CLIENT_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    assert.throws(() => encryptToken("x"), /BANK_TOKEN_ENCRYPTION_KEY/);
  } finally {
    for (const [name, value] of Object.entries({
      BANK_TOKEN_ENCRYPTION_KEY: previous.key,
      BANK_CLIENT_SECRET: previous.client,
      SUPABASE_SERVICE_ROLE_KEY: previous.service,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("un valore malformato con il prefisso giusto viene rifiutato", () => {
  const restore = withKey("test-key-1");
  try {
    assert.throws(() => decryptToken(`${ENCRYPTED_TOKEN_PREFIX}non-un-formato`), /malformato/i);
  } finally {
    restore();
  }
});
