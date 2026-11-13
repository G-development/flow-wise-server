-- Migrazione 017 (13/11/2026): colore e icona per categoria, scelti dall'utente.
--
-- Valori: nomi corti (es. color 'green', icon 'shopping-cart'); l'elenco ammesso sta nel codice
-- (server utils/categoryStyle.js, client lib/categoryStyle.ts), qui solo la forma, cosi' aggiungere
-- un colore o un'icona non richiede una migrazione. NULL = nessuna scelta: il client usa un colore
-- stabile ricavato dall'id e un'icona generica.
-- Idempotente; innocua per il codice precedente (colonne facoltative). Rollback nel .down.sql.

ALTER TABLE public."Category"
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS icon text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_color_format_chk') THEN
    ALTER TABLE public."Category"
      ADD CONSTRAINT category_color_format_chk CHECK (color IS NULL OR color ~ '^[a-z]{3,12}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_icon_format_chk') THEN
    ALTER TABLE public."Category"
      ADD CONSTRAINT category_icon_format_chk CHECK (icon IS NULL OR icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
END $$;

COMMENT ON COLUMN public."Category".color IS 'Colore scelto (es. green), NULL = automatico. Migrazione 017.';
COMMENT ON COLUMN public."Category".icon IS 'Icona scelta (es. shopping-cart), NULL = generica. Migrazione 017.';
