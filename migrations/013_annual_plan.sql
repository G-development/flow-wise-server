-- 013_annual_plan.sql
--
-- Piano delle spese annuali (fase 3, TODO_SALVADANAI.md): voci con rate esplicite pagate da
-- un salvadanaio (es. Annuali), e tetti dei salvadanai.
--
-- 1. `annual_items`: una voce (assicurazione, bollo, universita'...) e il salvadanaio che la
--    paga (`pot_wallet_id`).
-- 2. `annual_installments`: le rate della voce, ognuna con data e importo previsto in
--    centesimi. Rate esplicite e non una regola "ogni N mesi": importi e numero di rate cambiano
--    di anno in anno. `transaction_id` collega, a mano, il pagamento vero; se la transazione
--    viene eliminata il collegamento si azzera e la rata torna "da pagare".
-- 3. `Wallet.cap_cents` (tetto fisso, facoltativo) e `Wallet.cap_from_plan` (tetto calcolato:
--    somma delle rate dei prossimi 12 mesi del piano). Non entrambi.
--
-- RLS attiva senza policy, come `category_rules`: le tabelle si leggono e si scrivono solo dal
-- server con la service-role key, che filtra sempre per utente. Innocua per il codice gia'
-- pubblicato (tabelle e colonne nuove, nessuna lettura esistente le tocca). Idempotente;
-- rollback in 013_annual_plan.down.sql.

CREATE TABLE IF NOT EXISTS annual_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  pot_wallet_id integer NOT NULL REFERENCES public."Wallet"(id),
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annual_items_user ON annual_items (user_id);

CREATE TABLE IF NOT EXISTS annual_installments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES annual_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  transaction_id bigint REFERENCES public."Transaction"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annual_installments_user_due ON annual_installments (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_annual_installments_item ON annual_installments (item_id);

ALTER TABLE annual_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE annual_installments ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS cap_cents integer,
  ADD COLUMN IF NOT EXISTS cap_from_plan boolean NOT NULL DEFAULT false;

ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_cap_chk,
  ADD CONSTRAINT wallet_cap_chk CHECK (
    (cap_cents IS NULL OR cap_cents > 0) AND NOT (cap_from_plan AND cap_cents IS NOT NULL)
  );

COMMENT ON COLUMN "Wallet".cap_cents IS
  'Tetto fisso del salvadanaio in centesimi (facoltativo). Migrazione 013.';
COMMENT ON COLUMN "Wallet".cap_from_plan IS
  'Tetto calcolato: somma delle rate dei prossimi 12 mesi del piano annuale. Esclude cap_cents. Migrazione 013.';
