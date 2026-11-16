/**
 * Sincronizzazione di tutte le banche (POST /bank/scheduler/sync-now), 16/11/2026.
 *
 * Invariante: una connessione con l'autorizzazione mai completata (`pending_account`, l'utente non e'
 * tornato dalla banca) si salta senza errore. Prima rendeva `success: false` e il workflow saltava
 * l'import di tutti gli utenti (15–16/11).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startFakeSupabase } from "../testutils/fakeSupabase.js";

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

const fake = await startFakeSupabase({
  tables: {
    bank_connections: [
      { id: 1, user_id: U1, bank_id: "ISYBANK_ITBBITMM", account_id: "pending_account", access_token: null, refresh_token: null },
      { id: 2, user_id: U2, bank_id: "OTHER_BANK", account_id: null, access_token: null, refresh_token: null },
    ],
  },
});
process.env.SUPABASE_URL = fake.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.BANK_MOCK_ENABLED = "false";
process.env.BANK_SCHEDULER_SECRET = "test-scheduler-secret";

const { forceBankSync, isPendingAuthorization } = await import("./bankSyncScheduler.js");
const express = (await import("express")).default;
const bankRouter = (await import("../routes/bank.js")).default;

const app = express();
app.use("/bank", bankRouter);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  return fake.close();
});

test("isPendingAuthorization: segnaposto o conto mancante", () => {
  assert.equal(isPendingAuthorization({ account_id: "pending_account" }), true);
  assert.equal(isPendingAuthorization({ account_id: null }), true);
  assert.equal(isPendingAuthorization({ account_id: "3350ca88-0000-4000-8000-000000000000" }), false);
});

test("le connessioni mai autorizzate si saltano senza errore", async () => {
  const summary = await forceBankSync();
  assert.equal(summary.connections, 2);
  for (const result of summary.results) {
    assert.equal(result.error, null);
    assert.equal(result.synced, 0);
    assert.equal(result.skipped, "authorization not completed");
  }
});

test("sync-now risponde success: true se l'unico problema e' un'autorizzazione mai completata", async () => {
  const res = await fetch(`${baseUrl}/bank/scheduler/sync-now`, {
    method: "POST",
    headers: { "x-scheduler-secret": "test-scheduler-secret" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
});
