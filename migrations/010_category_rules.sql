-- 010_category_rules.sql
--
-- Regole locali di categorizzazione per l'import automatico dei movimenti bancari.
-- Sostituiscono la categorizzazione via LLM esterno: i dati dei movimenti restano su
-- Flow-Wise.
--
-- Una regola dice: "un movimento di tipo `type` la cui descrizione (o controparte)
-- contiene la parola chiave `keyword` va nella categoria `category_id`".
-- - `keyword` e' gia' normalizzata (minuscole, senza accenti, solo lettere e spazi) e si
--   confronta a parole intere: 'conad' trova "PAGAM. TRAMITE POS CONAD SUPERMERCATO".
-- - Se piu' regole combaciano vince la parola chiave piu' lunga (la piu' specifica).
-- - `source`: 'manual' = scritta o confermata da Gio; 'learned' = imparata da una sua
--   correzione della categoria di un movimento importato (PUT /transaction/:id).
--
-- Unicita' su (user_id, type, keyword): una correzione successiva aggiorna la regola
-- invece di crearne un'altra. Se la categoria viene cancellata, le sue regole spariscono.
--
-- RLS attiva senza policy: la tabella si legge e si scrive solo dal server, con la
-- service-role key. Idempotente; reversibile con 010_category_rules.down.sql.

CREATE TABLE IF NOT EXISTS category_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type varchar(1) NOT NULL CHECK (type IN ('I', 'E')),
  keyword varchar(100) NOT NULL CHECK (keyword ~ '^[a-z]+( [a-z]+)*$'),
  category_id integer NOT NULL REFERENCES public."Category"(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'learned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, keyword)
);

CREATE INDEX IF NOT EXISTS idx_category_rules_user ON category_rules (user_id);

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;
