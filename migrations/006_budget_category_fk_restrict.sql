-- 006_budget_category_fk_restrict.sql
--
-- Perche': `Budget_categoryid_fkey` era `ON DELETE CASCADE`. Una categoria referenziata
-- SOLO da un budget passava il guard di `DELETE /category/:id` (che contava solo
-- `Transaction`), veniva cancellata con un 200 e si portava via i budget collegati senza un
-- errore, un avviso o una traccia nella risposta: cancellazione silenziosa di dati di soldi,
-- esattamente il failure mode che il criterio di accettazione di T4.9 dichiarava
-- inaccettabile.
--
-- Provato sul DB LIVE il 2026-10-11, non solo sul dump del 2026-03-17: create una Category e
-- un Budget usa-e-getta, cancellata la Category, la DELETE e' passata con 200 e il Budget e'
-- sparito. L'azione ON DELETE non e' leggibile via PostgREST (`information_schema.referential
-- _constraints` e `pg_constraint` non sono esposti) e non esiste un DATABASE_URL, quindi la
-- prova e' comportamentale: `.probe-t_41281230/probe-budget-fk.mjs` (crea, cancella, osserva,
-- pulisce; solo righe proprie con prefisso `__fk_probe_`).
--
-- Cosa cambia: la FK passa a `ON DELETE RESTRICT`. Il guard applicativo
-- (`routes/category.js`) resta il primo livello e produce il 409 esplicito che l'utente puo'
-- agire; RESTRICT e' la rete sotto, cosi' il DB difende l'invariante "una categoria in uso
-- non si cancella" anche se domani un'altra rotta dimentica il guard.
--
-- RESTRICT e non NO ACTION: entrambe rifiutano la delete, ma NO ACTION e' differibile e
-- PostgreSQL la controlla a fine transazione, mentre RESTRICT e' immediata e non
-- differibile. Osservabile oggi e' identico (una delete per volta, in autocommit), ma
-- RESTRICT esprime l'intenzione senza lasciare una scappatoia.
--
-- Costo: nullo. `Budget` ha 0 righe (misurato via PostgREST), quindi la ADD CONSTRAINT non
-- deve validare nulla; nessuna riga di `routes/` referenzia la tabella `Budget`, quindi
-- nessun percorso applicativo dipendeva dal CASCADE.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT riportano la constraint allo stesso
-- stato anche se il file viene rieseguito. La DROP+ADD non distrugge dati: cambiare la regola
-- di delete non tocca le righe esistenti.
--
-- ONWARD: il rollback e' `006_budget_category_fk_restrict.down.sql` (ripristina il CASCADE).
-- Se in futuro servisse cancellare una categoria insieme ai suoi budget, la strada e' una
-- cancellazione DICHIARATA nell'applicazione (contare i budget e chiedere conferma), non un
-- CASCADE silenzioso nel DB.
--
-- NOTA: resta aperto, ed e' un'altra card, `Budget_walletid_fkey` che e' anch'essa
-- `ON DELETE CASCADE`: cancellare un Wallet porta via i suoi budget, sempre in silenzio, e
-- `DELETE /wallet/:id` non ha alcun guard.

ALTER TABLE ONLY public."Budget"
  DROP CONSTRAINT IF EXISTS "Budget_categoryid_fkey";

ALTER TABLE ONLY public."Budget"
  ADD CONSTRAINT "Budget_categoryid_fkey"
  FOREIGN KEY (categoryid) REFERENCES public."Category"(id) ON DELETE RESTRICT;

-- Esito (una riga per il report di chi esegue la migrazione).
-- confdeltype: 'r' = RESTRICT (atteso), 'c' = CASCADE (migrazione non applicata), 'a' = NO ACTION.
SELECT
  c.conname                                                        AS constraint_name,
  c.confdeltype                                                    AS delete_rule,
  (SELECT count(*) FROM public."Budget")                           AS budget_righe,
  (SELECT count(*) FROM public."Category")                         AS category_righe
FROM pg_constraint c
WHERE c.conname = 'Budget_categoryid_fkey'
  AND c.conrelid = 'public."Budget"'::regclass;
