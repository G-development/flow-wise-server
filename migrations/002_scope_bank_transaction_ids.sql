-- A provider transaction ID is not necessarily unique across users, banks, or accounts.
ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_external_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_user_bank_external_id_key
  ON bank_transactions (user_id, bank_id, account_id, external_id);
