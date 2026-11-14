-- Migrazione 018 (14/11/2026): toglie la tabella "Saving", residuo di un primo tentativo di obiettivi di
-- risparmio. Non la usa nessuna parte del codice (server e client) e sul live era vuota (backup del 13/11:
-- 0 righe). Al suo posto ci sono i salvadanai (migrazione 012, Wallet.kind = 'pot').
--
-- Sicurezza: se la tabella avesse righe la migrazione si ferma invece di cancellarle.
-- Idempotente. Rollback (ricrea la tabella vuota) nel .down.sql.

DO $$
BEGIN
  IF to_regclass('public."Saving"') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."Saving") THEN
      RAISE EXCEPTION 'Saving is not empty: nothing dropped';
    END IF;
    DROP TABLE public."Saving";
  END IF;
END $$;
