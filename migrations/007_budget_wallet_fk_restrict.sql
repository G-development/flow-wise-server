-- 007_budget_wallet_fk_restrict.sql
--
-- Perche': `Budget_walletid_fkey` era `ON DELETE CASCADE` e `DELETE /wallet/:id` non aveva
-- alcun guard. Cancellare un wallet si portava via i budget collegati con un 200: nessun
-- errore, nessun avviso, nessuna traccia nella risposta. Stesso failure mode della categoria
-- con i suoi budget (t_41281230, migrazione 006), ma sul lato wallet.
--
-- Provato sul DB LIVE il 2026-10-11, non solo dedotto dal dump del 2026-03-17: creato un
-- Wallet usa-e-getta con un Budget che lo referenzia, cancellato il Wallet, la DELETE e'
-- passata con 200 e il Budget e' sparito (`.probe-t_772c0b10/probe-wallet-fk.mjs`, esito
-- "CASCADE (budget sparito in silenzio)", cleanup a 0 righe). L'azione ON DELETE non e'
-- leggibile via PostgREST (`pg_constraint` non e' esposto) e non esiste un DATABASE_URL,
-- quindi la prova e' comportamentale.
--
-- Cosa cambia: la FK passa a `ON DELETE RESTRICT`. Il guard applicativo (`routes/wallet.js`)
-- resta il primo livello e produce il 409 esplicito che l'utente puo' agire; RESTRICT e' la
-- rete sotto, cosi' il DB difende l'invariante "un wallet in uso non si cancella" anche se
-- domani un'altra rotta dimentica il guard (il 23503 viene tradotto in 409).
--
-- RESTRICT e non NO ACTION: entrambe rifiutano la delete, ma NO ACTION e' differibile e
-- PostgreSQL la controlla a fine transazione, mentre RESTRICT e' immediata. Osservabile oggi
-- e' identico (una delete per volta, in autocommit), ma RESTRICT esprime l'intenzione senza
-- lasciare una scappatoia.
--
-- Costo: nullo. `Budget` ha 0 righe (misurato via PostgREST il 2026-10-11), quindi la ADD
-- CONSTRAINT non deve validare nulla; e nessuna riga di `routes/` referenzia la tabella
-- `Budget`, quindi nessun percorso applicativo dipendeva dal CASCADE.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT riportano la constraint allo stesso
-- stato anche se il file viene rieseguito. La DROP+ADD non distrugge dati: cambiare la regola
-- di delete non tocca le righe esistenti.
--
-- ONWARD: il rollback e' `007_budget_wallet_fk_restrict.down.sql` (ripristina il CASCADE).
-- Se in futuro servisse cancellare un wallet insieme ai suoi budget, la strada e' una
-- cancellazione DICHIARATA nell'applicazione (contare i budget e chiedere conferma), non un
-- CASCADE silenzioso nel DB.
--
-- NOTA — le altre due FK su `Wallet` non richiedono nulla qui:
--   `Transaction_wallet_id_fkey` non ha azione ON DELETE, quindi il DB rifiuta gia' la delete
--   con 23503 e il guard lo traduce in un 409 esplicito;
--   `Saving_walletid_fkey` e' anch'essa CASCADE ma la tabella `Saving` e' MORTA: 0 righe sul
--   DB live (misurato il 2026-10-11) e nessun riferimento in nessuno dei due repo. Resta
--   fuori perimetro: se un giorno quella tabella tornasse viva, la riga da aggiungere qui e'
--   la stessa e il guard in `routes/wallet.js` va esteso di un count su `Saving`.

ALTER TABLE ONLY public."Budget"
  DROP CONSTRAINT IF EXISTS "Budget_walletid_fkey";

ALTER TABLE ONLY public."Budget"
  ADD CONSTRAINT "Budget_walletid_fkey"
  FOREIGN KEY (walletid) REFERENCES public."Wallet"(id) ON DELETE RESTRICT;

-- Esito (una riga per il report di chi esegue la migrazione).
-- confdeltype: 'r' = RESTRICT (atteso), 'c' = CASCADE (migrazione non applicata), 'a' = NO ACTION.
SELECT
  c.conname                                        AS constraint_name,
  c.confdeltype                                    AS delete_rule,
  (SELECT count(*) FROM public."Budget")           AS budget_righe,
  (SELECT count(*) FROM public."Wallet")           AS wallet_righe
FROM pg_constraint c
WHERE c.conname = 'Budget_walletid_fkey'
  AND c.conrelid = 'public."Budget"'::regclass;
