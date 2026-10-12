<!-- rigenerato da scripts/repo-map.mjs nella skill repo-context-and-maps — non modificare a mano -->

# CODE_MAP — flow-wise-server

Indice file-per-file generato dal codice, non dalla documentazione. Serve a sapere **dove** sta una
cosa senza leggere il repo: architettura e regole locali stanno altrove (vedi `AGENTS.md`).

Forma `express`, radice sorgente `.`, commit `bf5772e`.

```bash
node <skill repo-context-and-maps>/scripts/repo-map.mjs /Users/giocuo/Projects/flow-wise-server \
  --out /Users/giocuo/Projects/flow-wise-server/CODE_MAP.md
```

## Entry point

- `GET /` — in `server.js`
- `GET /hello` — in `server.js`
- `GET /healthz` — in `server.js`

## Moduli route e mount (da `server.js`)

| Modulo | Mount |
| --- | --- |
| `routes/agents.js` | `/agents` |
| `routes/auth.js` | `/auth` |
| `routes/bank.js` | `/bank` |
| `routes/category.js` | `/category` |
| `routes/dashboard-layout.js` | `/dashboard-layout` |
| `routes/expense.js` | `/expense` |
| `routes/import.js` | `/import` |
| `routes/income.js` | `/income` |
| `routes/transaction.js` | `/transaction` |
| `routes/user.js` | `/users` |
| `routes/wallet.js` | `/wallet` |

## routes/

- `routes/agents.js` — mount `/agents` — exports: const `AGENT_ROWS_LIMIT`, `applyExpenseFilters`, `buildCoverage`, `buildExpensesCountQuery`, `buildExpensesQuery`, `fetchExpenseSlice`, `runExpenseAnalysis`; default `router`
  - `POST /agents/analytics` — `requireAuth`
- `routes/agents.test.js` — test
- `routes/auth.js` — mount `/auth` — exports: default `router`
  - `POST /auth/forgot-password` — pubblico
  - `POST /auth/verify-reset-token` — pubblico
  - `POST /auth/reset-password` — pubblico
- `routes/bank.js` — mount `/bank` — exports: default `router`
  - `GET /bank/config` — `requireAuth`
  - `GET /bank/institutions` — `requireAuth`
  - `GET /bank/authorize` — `requireAuth`
  - `GET /bank/mock-auth` — pubblico
  - `GET /bank/callback` — pubblico
  - `GET /bank/connections` — `requireAuth`
  - `GET /bank/status` — `requireAuth`
  - `POST /bank/sync` — `requireAuth`
  - `GET /bank/transactions` — `requireAuth`
  - `POST /bank/import` — `requireAuth`
  - `POST /bank/disconnect` — `requireAuth`
  - `GET /bank/scheduler/status` — header `x-scheduler-secret`
  - `POST /bank/scheduler/sync-now` — header `x-scheduler-secret`
- `routes/category.js` — mount `/category` — exports: const `createCategoryRouter`
  - `GET /category` — middleware `auth`
  - `GET /category/active` — middleware `auth`
  - `GET /category/:id` — middleware `auth`
  - `POST /category` — middleware `auth`
  - `PUT /category/:id` — middleware `auth`
  - `DELETE /category/:id` — middleware `auth`
- `routes/category.pagination.test.js` — test
- `routes/category.test.js` — test
- `routes/dashboard-layout.js` — mount `/dashboard-layout` — exports: default `router`
  - `GET /dashboard-layout` — `requireAuth`
  - `PUT /dashboard-layout` — `requireAuth`
- `routes/expense.js` — mount `/expense` — exports: default `router`
  - `GET /expense/all` — `requireAuth`
- `routes/import.js` — mount `/import` — exports: const `createImportRouter`; fn `parseAmountValue`
  - `POST /import/csv` — middleware `auth`
- `routes/import.test.js` — test
- `routes/importCsv.test.js` — test
- `routes/income.js` — mount `/income` — exports: default `router`
  - `GET /income/all` — `requireAuth`
- `routes/pagination.test.js` — test
- `routes/readIsolation.test.js` — test
- `routes/transaction.js` — mount `/transaction` — exports: default `router`
  - `GET /transaction/all` — `requireAuth`
  - `GET /transaction/:id` — `requireAuth`
  - `POST /transaction` — `requireAuth`
  - `PUT /transaction/:id` — `requireAuth`
  - `DELETE /transaction/:id` — `requireAuth`
- `routes/user.js` — mount `/users` — exports: default `router`
  - `POST /users/register` — pubblico
  - `GET /users/profile` — `requireAuth`
  - `POST /users/profile/photo` — `requireAuth`
- `routes/wallet.balance.test.js` — test
- `routes/wallet.delete.test.js` — test
- `routes/wallet.invariants.test.js` — test
- `routes/wallet.js` — mount `/wallet` — exports: default `router`
  - `GET /wallet` — `requireAuth`
  - `POST /wallet` — `requireAuth`
  - `PUT /wallet/:id` — `requireAuth`
  - `DELETE /wallet/:id` — `requireAuth`

## agents/

- `agents/analyticsAgent.js` — exports: const `analyzeExpensesWithAI`, `summarizeExpensesForAI`

## utils/

- `utils/amount.js` — exports: const `amountToCents`, `signedAmountCents`
- `utils/amount.test.js` — test
- `utils/asyncHandler.js` — exports: const `asyncHandler`
- `utils/bankService.js` — exports: const `createBankOAuthState`, `disconnectBankConnection`, `ensureValidToken`, `fetchTransactions`, `generateMockBankTransactions`, `getAuthorizationUrl`, `getBankConnection`, `getBankSetupStatus`, `getGoCardlessToken`, `getSupportedBanks`, `getUserBankConnections`, `getUserBankTransactions`, `handleGoCardlessCallback`, `importBankTransactionsToApp`, `isMockBankModeEnabled`, `POPULAR_BANKS`, `saveBankConnection`, `syncBankTransactions`, `verifyBankOAuthState`
- `utils/bankService.test.js` — test
- `utils/bankSyncScheduler.js` — exports: const `forceBankSync`, `getBankSyncStatus`, `startBankSyncScheduler`, `stopBankSyncScheduler`
- `utils/bankTokenCrypto.js` — exports: const `decryptToken`, `ENCRYPTED_TOKEN_PREFIX`, `encryptToken`, `isEncryptedToken`
- `utils/bankTokenCrypto.test.js` — test
- `utils/paginatedSelect.js` — exports: const `DEFAULT_MAX_PAGES`, `DEFAULT_PAGE_SIZE`, `fetchAllRows`, `toListResponse`
- `utils/paginatedSelect.test.js` — test
- `utils/passwordResetService.js` — exports: const `createPasswordResetToken`, `findUserByEmail`, `isValidPassword`, `LIST_USERS_MAX_PAGES`, `LIST_USERS_PAGE_SIZE`, `requestPasswordReset`, `resetUserPassword`, `sendPasswordResetEmail`, `verifyResetToken`
- `utils/passwordResetService.test.js` — test
- `utils/schemas.js` — exports: const `categoryCreateSchema`, `categoryUpdateSchema`, `importCsvSchema`, `transactionCreateSchema`, `transactionUpdateSchema`, `userRegisterSchema`, `walletCreateSchema`, `walletUpdateSchema`
- `utils/schemas.test.js` — test
- `utils/validate.js` — exports: const `validate`
- `utils/walletService.js` — exports: const `getWalletBalance`, `getWalletsWithBalances`, `sumBalancesInCents`
- `utils/walletService.test.js` — test
- `utils/walletUpdateSchema.test.js` — test

## config/

- `config/auth-middleware.js` — exports: const `requireAuth`
- `config/cloudinary.js` — exports: default `cloudinary`
- `config/supabaseClient.js` — exports: const `supabase`

## testutils/

- `testutils/fakeSupabase.js` — exports: const `FAKE_DB_MAX_ROWS`, `startFakeSupabase`

## migrations/

- `migrations/001_create_bank_tables.sql` — Tabella per le connessioni bancarie
- `migrations/002_create_password_reset_tokens.sql` — Tabella per i token di reset password
- `migrations/002_scope_bank_transaction_ids.sql` — A provider transaction ID is not necessarily unique across users, banks, or accounts.
- `migrations/003_wallet_opening_balance.sql` — 003_wallet_opening_balance.sql
- `migrations/004_wallet_invariants.down.sql` — 004_wallet_invariants.down.sql
- `migrations/004_wallet_invariants.sql` — 004_wallet_invariants.sql
- `migrations/005_drop_wallet_balance.down.sql` — 005_drop_wallet_balance.down.sql
- `migrations/005_drop_wallet_balance.sql` — 005_drop_wallet_balance.sql
- `migrations/006_budget_category_fk_restrict.down.sql` — 006_budget_category_fk_restrict.down.sql
- `migrations/006_budget_category_fk_restrict.sql` — 006_budget_category_fk_restrict.sql
- `migrations/007_budget_wallet_fk_restrict.down.sql` — 007_budget_wallet_fk_restrict.down.sql
- `migrations/007_budget_wallet_fk_restrict.sql` — 007_budget_wallet_fk_restrict.sql

## Script di radice

- `backfill-opening-balance.mjs` — /**
- `check-db.mjs` — Script di check DB rimosso. Lasciato intenzionalmente vuoto.
- `migrate-bank-tokens.mjs` — /**
