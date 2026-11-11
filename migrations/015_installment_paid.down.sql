-- 015_installment_paid.down.sql
--
-- Annulla 015_installment_paid.sql: le rate segnate pagate solo a mano tornano "da pagare".

ALTER TABLE annual_installments
  DROP COLUMN IF EXISTS is_paid;
