-- 015_installment_paid.sql
--
-- Rata del piano annuale segnata come pagata a mano (richiesta di Gio, 11/11/2026).
--
-- Fino alla 013 una rata era "pagata" solo se collegata alla transazione che l'ha pagata
-- (`transaction_id`). Non sempre quel movimento c'e' o conviene cercarlo: `is_paid` permette di
-- segnarla pagata e basta. Pagata = `is_paid` OPPURE collegata a una transazione; il collegamento
-- resta facoltativo.
--
-- Innocua per il codice gia' pubblicato: colonna nuova con default false, il server di oggi non
-- la legge. Idempotente; rollback in 015_installment_paid.down.sql.

ALTER TABLE annual_installments
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN annual_installments.is_paid IS
  'Rata segnata come pagata a mano, anche senza transaction_id. Migrazione 015.';
