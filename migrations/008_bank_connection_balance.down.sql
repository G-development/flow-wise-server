ALTER TABLE bank_connections
  DROP COLUMN IF EXISTS balance_raw_data,
  DROP COLUMN IF EXISTS balance_fetched_at,
  DROP COLUMN IF EXISTS balance_provider_updated_at,
  DROP COLUMN IF EXISTS balance_reference_date,
  DROP COLUMN IF EXISTS balance_type,
  DROP COLUMN IF EXISTS balance_currency,
  DROP COLUMN IF EXISTS balance_amount;
