DROP INDEX IF EXISTS idx_bank_transactions_auto_import;
DROP INDEX IF EXISTS transaction_bank_transaction_id_key;

ALTER TABLE public."Transaction"
  DROP COLUMN IF EXISTS bank_transaction_id;

ALTER TABLE bank_transactions
  DROP COLUMN IF EXISTS booking_status;

ALTER TABLE bank_connections
  DROP COLUMN IF EXISTS auto_import_from,
  DROP COLUMN IF EXISTS import_wallet_id;
