-- 013_annual_plan.down.sql
--
-- Annulla 013_annual_plan.sql. Le voci e le rate del piano vengono eliminate con le tabelle:
-- non tocca transazioni ne' wallet (solo le due colonne del tetto).

DROP TABLE IF EXISTS annual_installments;
DROP TABLE IF EXISTS annual_items;

ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_cap_chk;

ALTER TABLE "Wallet"
  DROP COLUMN IF EXISTS cap_from_plan,
  DROP COLUMN IF EXISTS cap_cents;
