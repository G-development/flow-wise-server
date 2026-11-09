-- 011_transfer_type.down.sql
--
-- Annulla 011_transfer_type.sql. Si ferma senza toccare nulla se esistono transazioni 'T':
-- togliere `to_wallet_id` perderebbe la destinazione dei trasferimenti senza dirlo.
-- Le categorie di tipo 'T' vengono eliminate; se una transazione le usa ancora, la DELETE
-- fallisce per la foreign key e il rollback si ferma lì.

DO $$
DECLARE
  n_t_rows integer;
BEGIN
  SELECT count(*) INTO n_t_rows FROM public."Transaction" WHERE type = 'T';
  IF n_t_rows > 0 THEN
    RAISE EXCEPTION 'transfer_type_down_blocked'
      USING ERRCODE = '45000',
            DETAIL  = format('%s transazioni T esistenti: convertirle o eliminarle prima del rollback', n_t_rows);
  END IF;
END
$$;

DELETE FROM public."Category" WHERE type = 'T';

DROP INDEX IF EXISTS category_one_transfer_per_user_idx;
DROP INDEX IF EXISTS idx_transaction_to_wallet_id;

ALTER TABLE public."Transaction"
  DROP CONSTRAINT IF EXISTS transaction_transfer_wallets_chk,
  DROP CONSTRAINT IF EXISTS transaction_income_expense_wallets_chk;

ALTER TABLE public."Transaction"
  DROP COLUMN IF EXISTS to_wallet_id;
