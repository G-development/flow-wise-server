-- 007_budget_wallet_fk_restrict.down.sql
--
-- Rollback di `007_budget_wallet_fk_restrict.sql`: riporta `Budget_walletid_fkey` a
-- `ON DELETE CASCADE`, cioe' allo stato pre-007.
--
-- ATTENZIONE: il down reintroduce la cancellazione silenziosa dei budget quando si cancella
-- un wallet che li referenzia. Serve a tornare indietro su una migrazione, non a "sistemare"
-- qualcosa: il comportamento corretto e' RESTRICT piu' il guard applicativo.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Nessun dato viene toccato.

ALTER TABLE ONLY public."Budget"
  DROP CONSTRAINT IF EXISTS "Budget_walletid_fkey";

ALTER TABLE ONLY public."Budget"
  ADD CONSTRAINT "Budget_walletid_fkey"
  FOREIGN KEY (walletid) REFERENCES public."Wallet"(id) ON DELETE CASCADE;

-- Esito: confdeltype 'c' = CASCADE (atteso dopo il rollback), 'r' = RESTRICT (non applicato).
SELECT
  c.conname        AS constraint_name,
  c.confdeltype    AS delete_rule,
  (SELECT count(*) FROM public."Budget") AS budget_righe
FROM pg_constraint c
WHERE c.conname = 'Budget_walletid_fkey'
  AND c.conrelid = 'public."Budget"'::regclass;
