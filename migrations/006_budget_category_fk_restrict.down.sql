-- 006_budget_category_fk_restrict.down.sql
--
-- Rollback di `006_budget_category_fk_restrict.sql`: riporta `Budget_categoryid_fkey` a
-- `ON DELETE CASCADE`, cioe' allo stato pre-006.
--
-- ATTENZIONE: il down reintroduce la cancellazione silenziosa dei budget quando si cancella
-- una categoria referenziata solo da un budget. Serve a tornare indietro su una migrazione,
-- non a "sistemare" qualcosa: il comportamento corretto e' RESTRICT piu' il guard applicativo.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. Nessun dato viene toccato.

ALTER TABLE ONLY public."Budget"
  DROP CONSTRAINT IF EXISTS "Budget_categoryid_fkey";

ALTER TABLE ONLY public."Budget"
  ADD CONSTRAINT "Budget_categoryid_fkey"
  FOREIGN KEY (categoryid) REFERENCES public."Category"(id) ON DELETE CASCADE;

-- Esito: confdeltype 'c' = CASCADE (atteso dopo il rollback), 'r' = RESTRICT (non applicato).
SELECT
  c.conname        AS constraint_name,
  c.confdeltype    AS delete_rule,
  (SELECT count(*) FROM public."Budget") AS budget_righe
FROM pg_constraint c
WHERE c.conname = 'Budget_categoryid_fkey'
  AND c.conrelid = 'public."Budget"'::regclass;
