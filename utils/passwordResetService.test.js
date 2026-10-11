/**
 * Ciclo di vita del token di reset password (creazione, scadenza 1h, uso
 * singolo, invio fallito, lookup multi-pagina).
 *
 * ## Comando
 *
 *     npm test
 *         -> node --test --experimental-test-module-mocks
 *
 * oppure, solo questo file:
 *
 *     node --test --experimental-test-module-mocks utils/passwordResetService.test.js
 *
 * ## Perché il flag `--experimental-test-module-mocks`
 *
 * `utils/passwordResetService.js` costruisce il client Supabase **e** il
 * transporter SMTP all'import (`createClient(...)`, `nodemailer.createTransport`),
 * e `requestPasswordReset` usa il client di modulo: non esiste un punto di
 * iniezione. Le due dipendenze esterne sono quindi sostituite con `mock.module`,
 * che in Node richiede il flag. Le finte sono deterministiche e senza rete: un
 * mini PostgREST/GoTrue in memoria per `password_reset_tokens` + Admin API, e un
 * transporter nodemailer il cui `sendMail` può essere fatto fallire a comando.
 *
 * ## Rosso prima / verde dopo
 *
 * La suite è stata eseguita anche contro la versione **pre-fix** del modulo
 * (e357988: `requestPasswordReset` con una sola pagina di `listUsers()`, `catch`
 * che restituisce `success: true`, token creato prima dell'invio). I casi marcati
 * `[pre-fix: rosso]` falliscono lì e passano sul codice attuale; quelli marcati
 * `[pre-fix: verde]` sono guardie di regressione sul comportamento che era già
 * corretto e che il riordino genera -> invia -> persisti non deve rompere.
 */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Il modulo costruisce client e transporter all'import: servono valori non vuoti
// anche se le dipendenze reali sono sostituite (stessa convenzione di
// utils/bankService.test.js).
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.FRONTEND_URL ||= "https://app.flow-wise.test";
process.env.SMTP_HOST ||= "smtp.test.invalid";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "gio@example.com" };
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Default di GoTrue quando `listUsers` viene chiamata senza `perPage`. */
const GOTRUE_DEFAULT_PER_PAGE = 50;

/** Errore PostgREST per `.single()` senza righe (406). */
const PGRST_NO_ROWS = "JSON object requested, multiple (or no) rows returned";

/**
 * Finto client Supabase: tutto in memoria, nessuna rete. Implementa solo il
 * sottoinsieme usato dal servizio (PostgREST su `password_reset_tokens` +
 * `auth.admin.listUsers`/`updateUserById`).
 */
const createFakeSupabase = () => {
  const state = {
    /** Righe di `password_reset_tokens`. */
    rows: [],
    /** (page, perPage) => { users, lastPage }: sorgente dell'Admin API. */
    dataset: null,
    listUsersError: null,
    listUsersCalls: [],
    userUpdates: [],
  };

  /** Builder con la stessa catena del client reale (`.eq().single()`, await). */
  const query = (exec) => {
    const filters = [];
    return {
      eq(column, value) {
        filters.push([column, value]);
        return this;
      },
      single() {
        return exec(filters, true);
      },
      then(resolve, reject) {
        return exec(filters, false).then(resolve, reject);
      },
    };
  };

  const matches = (row, filters) => filters.every(([col, val]) => row[col] === val);

  const client = {
    from(table) {
      assert.equal(table, "password_reset_tokens", `tabella inattesa: ${table}`);
      return {
        insert(row) {
          return query(async () => {
            state.rows.push({ ...row });
            return { data: null, error: null };
          });
        },
        select() {
          return query(async (filters, single) => {
            const found = state.rows.filter((row) => matches(row, filters));
            if (!single) return { data: found, error: null };
            if (found.length !== 1) return { data: null, error: { message: PGRST_NO_ROWS } };
            return { data: { ...found[0] }, error: null };
          });
        },
        update(patch) {
          return query(async (filters) => {
            let updated = 0;
            for (const row of state.rows) {
              if (matches(row, filters)) {
                Object.assign(row, patch);
                updated += 1;
              }
            }
            return { data: null, error: null, updated };
          });
        },
      };
    },
    auth: {
      admin: {
        async listUsers(params = {}) {
          const page = params.page ?? 1;
          const perPage = params.perPage ?? GOTRUE_DEFAULT_PER_PAGE;
          state.listUsersCalls.push({ page, perPage });

          if (state.listUsersError) return { data: null, error: state.listUsersError };

          assert.ok(state.dataset, "dataset non configurato: chiamare resetFakes()");
          const { users, lastPage } = state.dataset(page, perPage);
          return {
            data: { users, nextPage: page < lastPage ? page + 1 : null, lastPage, total: null },
            error: null,
          };
        },
        async updateUserById(userId, attributes) {
          state.userUpdates.push({ userId, password: attributes.password });
          return { data: { id: userId }, error: null };
        },
      },
    },
  };

  return {
    client,
    state,
    reset({ users = [USER], dataset = null } = {}) {
      state.rows = [];
      state.listUsersCalls = [];
      state.listUsersError = null;
      state.userUpdates = [];
      state.dataset = dataset ?? paged(users);
    },
  };
};

/** Sorgente paginata che imita GoTrue: `perPage` decide il taglio. */
const paged = (users) => (page, perPage) => ({
  users: users.slice((page - 1) * perPage, page * perPage),
  lastPage: Math.max(1, Math.ceil(users.length / perPage)),
});

/** Sorgente senza fine: ogni pagina è piena, per esercitare il tetto di pagine. */
const endless = (lastPage) => (page, perPage) => ({
  users: Array.from({ length: perPage }, (_, i) => ({
    id: `u${page}-${i}`,
    email: `u${page}-${i}@test.invalid`,
  })),
  lastPage,
});

const datasetOf = (size) =>
  Array.from({ length: size }, (_, i) => ({ id: `u${i}`, email: `user${i}@test.invalid` }));

/** Finto transporter nodemailer: registra gli invii e può fallire a comando. */
const createFakeMailer = () => {
  const state = { sent: [], error: null, transportConfigs: [] };

  const transporter = {
    async sendMail(options) {
      state.sent.push(options);
      if (state.error) throw state.error;
      return { response: "250 OK" };
    },
  };

  return {
    state,
    transporter,
    reset({ error = null } = {}) {
      state.sent = [];
      state.error = error;
      state.transportConfigs = [];
    },
  };
};

const supabaseFake = createFakeSupabase();
const mailerFake = createFakeMailer();

// Sostituzione delle dipendenze esterne PRIMA di importare il modulo.
mock.module("@supabase/supabase-js", {
  exports: { createClient: () => supabaseFake.client },
});
mock.module("nodemailer", {
  exports: {
    default: {
      createTransport: (config) => {
        mailerFake.state.transportConfigs.push(config);
        return mailerFake.transporter;
      },
    },
  },
});

const {
  requestPasswordReset,
  createPasswordResetToken,
  verifyResetToken,
  resetUserPassword,
  findUserByEmail,
  LIST_USERS_PAGE_SIZE,
  LIST_USERS_MAX_PAGES,
} = await import("./passwordResetService.js");

/** Stato pulito per ogni test: SMTP configurato, invio che riesce. */
const resetFakes = ({ users = [USER], dataset = null, mailError = null } = {}) => {
  supabaseFake.reset({ users, dataset });
  mailerFake.reset({ error: mailError });
  process.env.SMTP_HOST = "smtp.test.invalid";
  process.env.FRONTEND_URL = "https://app.flow-wise.test";
};

const withoutSmtpHost = async (run) => {
  const previous = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  try {
    return await run();
  } finally {
    process.env.SMTP_HOST = previous;
  }
};

// ---------------------------------------------------------------------------
// 1) CREAZIONE  [pre-fix: verde] il difetto non era qui, ma questa è la
// invariante che il riordino (genera -> invia -> persisti) non deve rompere.
// ---------------------------------------------------------------------------

test("creazione: una richiesta valida crea un token per quell'utente", async () => {
  resetFakes();
  const before = Date.now();
  const result = await requestPasswordReset(USER.email);
  const after = Date.now();

  assert.deepEqual(result, {
    success: true,
    message: "Reset link has been sent to your email",
  });

  assert.equal(mailerFake.state.sent.length, 1, "una sola email inviata");
  assert.equal(supabaseFake.state.rows.length, 1, "un solo token persistito");

  const row = supabaseFake.state.rows[0];
  assert.equal(row.user_id, USER.id, "il token è associato all'utente trovato");
  assert.equal(row.email, USER.email);
  assert.equal(row.used, false);
  assert.match(row.token, /^[0-9a-f]{64}$/);

  const expiresAt = new Date(row.expires_at).getTime();
  assert.ok(
    expiresAt >= before + ONE_HOUR_MS && expiresAt <= after + ONE_HOUR_MS,
    `scadenza attesa a +1h, trovata ${new Date(row.expires_at).toISOString()}`
  );

  const email = mailerFake.state.sent[0];
  assert.equal(email.to, USER.email);
  assert.ok(email.html.includes(`token=${row.token}`), "l'URL inviato contiene quel token");
  assert.ok(email.html.includes(encodeURIComponent(USER.email)));

  // Il token appena creato è utilizzabile (una volta).
  assert.equal(await resetUserPassword(USER.id, row.token, "NuovaPass1!"), true);
});

// ---------------------------------------------------------------------------
// 2) SCADENZA 1h  [pre-fix: verde] guardia di regressione: il token sopravvive
// al riordino ma deve restare valido 1 ora esatta.
// ---------------------------------------------------------------------------

test("scadenza: valido fino a 59 minuti, scaduto oltre i 60", async (t) => {
  resetFakes();
  const now = 1_791_737_000_000;
  t.mock.timers.enable({ apis: ["Date"], now });

  try {
    const token = await createPasswordResetToken(USER.id, USER.email);
    assert.equal(
      new Date(supabaseFake.state.rows[0].expires_at).getTime(),
      now + ONE_HOUR_MS,
      "expires_at è esattamente +1h",
    );

    t.mock.timers.setTime(now + 59 * 60 * 1000);
    assert.equal((await verifyResetToken(token)).user_id, USER.id, "a 59 minuti è ancora valido");

    t.mock.timers.setTime(now + ONE_HOUR_MS + 1);
    await assert.rejects(() => verifyResetToken(token), /Invalid or expired token/);
    await assert.rejects(
      () => resetUserPassword(USER.id, token, "NuovaPass1!"),
      /Invalid or expired token/
    );
    assert.equal(
      supabaseFake.state.userUpdates.length,
      0,
      "un token scaduto non cambia la password"
    );
  } finally {
    t.mock.timers.reset();
  }
});

// ---------------------------------------------------------------------------
// 3) USO SINGOLO  [pre-fix: verde] guardia di regressione sul token `used`.
// ---------------------------------------------------------------------------

test("uso singolo: il secondo tentativo con lo stesso token fallisce", async () => {
  resetFakes();
  const token = await createPasswordResetToken(USER.id, USER.email);

  assert.equal(await resetUserPassword(USER.id, token, "NuovaPass1!"), true);
  assert.equal(supabaseFake.state.userUpdates.length, 1);
  assert.equal(supabaseFake.state.rows[0].used, true, "il token è marcato come usato");

  await assert.rejects(
    () => resetUserPassword(USER.id, token, "AltraPass2!"),
    /Invalid or expired token/
  );
  await assert.rejects(() => verifyResetToken(token), /Invalid or expired token/);
  assert.equal(
    supabaseFake.state.userUpdates.length,
    1,
    "la password viene cambiata una volta sola"
  );
});

// ---------------------------------------------------------------------------
// 4) INVIO FALLITO  [pre-fix: rosso] pre-fix il catch restituiva success:true e
// il token era già stato creato prima dell'invio.
// ---------------------------------------------------------------------------

test("invio fallito (SMTP_HOST assente): nessun success:true, nessun token", async () => {
  resetFakes();

  await withoutSmtpHost(async () => {
    const result = await requestPasswordReset(USER.email);

    assert.equal(result.success, false, "l'esito reale non va nascosto");
    assert.match(result.error, /SMTP_HOST is not configured/);
    assert.equal(mailerFake.state.sent.length, 0, "nessun invio tentato");
    assert.deepEqual(supabaseFake.state.rows, [], "nessun token orfano");
  });
});

test("invio fallito (transporter che lancia): nessun success:true, nessun token", async () => {
  resetFakes({ mailError: new Error("connect ECONNREFUSED 127.0.0.1:25") });

  const result = await requestPasswordReset(USER.email);

  assert.equal(result.success, false);
  assert.match(result.error, /Failed to send reset email: connect ECONNREFUSED/);
  assert.equal(mailerFake.state.sent.length, 1, "l'invio è stato tentato");
  assert.deepEqual(supabaseFake.state.rows, [], "nessun token orfano");
});

test("errore della Admin API: visibile, non un 'utente inesistente'", async () => {
  resetFakes();
  supabaseFake.state.listUsersError = { message: "boom" };

  await assert.rejects(() => findUserByEmail(USER.email), /Failed to list users: boom/);

  const result = await requestPasswordReset(USER.email);
  assert.equal(result.success, false);
  assert.match(result.error, /Failed to list users: boom/);
  assert.deepEqual(supabaseFake.state.rows, []);
});

// ---------------------------------------------------------------------------
// 5) LOOKUP MULTI-PAGINA  [pre-fix: rosso] pre-fix `listUsers()` senza
// `page`/`perPage` leggeva solo la prima pagina (default GoTrue: 50 utenti).
// ---------------------------------------------------------------------------

test("lookup multi-pagina: l'utente oltre la prima pagina viene trovato", async () => {
  const users = datasetOf(1500);
  const target = users[1200]; // con perPage 1000 sta in pagina 2
  resetFakes({ users });

  const found = await findUserByEmail(target.email);
  assert.equal(found?.id, target.id);
  assert.deepEqual(
    supabaseFake.state.listUsersCalls,
    [
      { page: 1, perPage: LIST_USERS_PAGE_SIZE },
      { page: 2, perPage: LIST_USERS_PAGE_SIZE },
    ],
    "legge le pagine del client, con perPage esplicito"
  );

  // Il ciclo completo funziona anche per quell'utente.
  const result = await requestPasswordReset(target.email);
  assert.equal(result.success, true);
  assert.equal(mailerFake.state.sent.length, 1);
  assert.equal(supabaseFake.state.rows.length, 1);
  assert.equal(supabaseFake.state.rows[0].user_id, target.id);
});

test("lookup multi-pagina: email assente -> null dopo tutte le pagine, nessun invio", async () => {
  resetFakes({ users: datasetOf(1500) });

  assert.equal(await findUserByEmail("nessuno@test.invalid"), null);
  assert.equal(supabaseFake.state.listUsersCalls.length, 2, "due pagine e poi si ferma");

  // Anti-enumerazione: resta il messaggio neutro, senza invio né token.
  const result = await requestPasswordReset("nessuno@test.invalid");
  assert.deepEqual(result, {
    success: true,
    message: "If email exists, reset link has been sent",
  });
  assert.equal(mailerFake.state.sent.length, 0);
  assert.deepEqual(supabaseFake.state.rows, []);
});

test("tetto di pagine: un dataset sempre pieno fallisce in modo visibile", async () => {
  resetFakes({ dataset: endless(LIST_USERS_MAX_PAGES + 50) });

  await assert.rejects(
    () => findUserByEmail("nessuno@test.invalid"),
    /page limit reached/
  );
  assert.equal(supabaseFake.state.listUsersCalls.length, LIST_USERS_MAX_PAGES);
});
