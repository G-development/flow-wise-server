-- 014_refunds.down.sql
--
-- Annulla 014_refunds.sql. Le righe che erano rimborsi tornano entrate normali con una
-- categoria di tipo E: prima di eseguirlo vanno riclassificate, o il controllo del server
-- (categoria dello stesso tipo) rifiutera' di modificarle.

ALTER TABLE "Transaction"
  DROP CONSTRAINT IF EXISTS transaction_refund_is_income_chk;

ALTER TABLE "Transaction"
  DROP COLUMN IF EXISTS is_refund;
