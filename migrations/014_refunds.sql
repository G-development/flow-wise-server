-- 014_refunds.sql
--
-- Rimborsi (fase 5, TODO_SALVADANAI.md, progetto approvato da Gio l'11/11/2026).
--
-- Quando Gio anticipa una spesa e gli altri gli restituiscono la loro parte (condominio, cene),
-- l'entrata non e' un'entrata: e' una spesa in meno di quella categoria, nel mese in cui arriva.
--
-- Un rimborso e' una riga `I` (i soldi entrano nel wallet: il saldo derivato e' giusto senza
-- toccare `walletDeltasCents`) con `is_refund = true` e una categoria di tipo `E`; il server lo
-- controlla in `checkTransactionReferences`, che conosce le categorie.
--
-- Una colonna e non un nuovo valore `R` di `type`: `type` e' un enum di Postgres e un valore
-- aggiunto non si puo' togliere, quindi non ci sarebbe un rollback. La colonna si rimuove pulita.
--
-- Innocua per il codice gia' pubblicato: colonna nuova con default false, nessuna riga cambia
-- significato. Idempotente; rollback in 014_refunds.down.sql.

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS is_refund boolean NOT NULL DEFAULT false;

ALTER TABLE "Transaction"
  DROP CONSTRAINT IF EXISTS transaction_refund_is_income_chk,
  ADD CONSTRAINT transaction_refund_is_income_chk CHECK (NOT is_refund OR type = 'I');

COMMENT ON COLUMN "Transaction".is_refund IS
  'Rimborso: entrata (type I) con categoria di spesa; nelle statistiche riduce le spese di quella categoria. Migrazione 014.';
