-- 012_wallet_pots.sql
--
-- Salvadanai (fase 2, TODO_SALVADANAI.md): un wallet puo' essere un conto (`account`) o un
-- salvadanaio (`pot`) che appartiene a un conto, come i salvadanai di Intesa Sanpaolo legati
-- al conto principale. I soldi entrano ed escono da un salvadanaio con trasferimenti `T`
-- (migrazione 011); il saldo resta derivato dalle transazioni (utils/walletService.js).
--
-- 1. `Wallet.kind` ('account' | 'pot', default 'account': i wallet esistenti sono conti) e
--    `Wallet.parent_wallet_id` (il conto del salvadanaio). Nessuna azione ON DELETE: un conto
--    con salvadanai non si elimina finche' i salvadanai esistono.
-- 2. Vincoli: un `pot` ha sempre un conto padre, un `account` mai; un `pot` non e' mai default.
-- 3. Trigger `wallet_check_parent`: il padre e' un `account` dello stesso utente.
-- 4. I trigger della 004 contano nel limite di 3 **solo i conti**: i salvadanai sono fuori dal
--    limite. Il primo conto resta default per definizione; un salvadanaio non lo diventa mai,
--    neanche quando si elimina il default (la promozione sceglie un conto).
-- 5. `wallet_set_default` rifiuta un salvadanaio con un errore riconoscibile (45004).
--
-- Codici d'errore nuovi (classe 45, come la 004):
--   45004  wallet_not_account   default richiesto su un salvadanaio
--   45005  wallet_bad_parent    padre assente, di un altro utente o non un conto
--
-- Innocua per il codice gia' pubblicato: i wallet esistenti diventano `account` e il codice
-- attuale non legge le colonne nuove. Pre-check, idempotente; rollback in 012_wallet_pots.down.sql.

-- 0) Pre-check: la 004 deve essere applicata (questa migrazione ne sostituisce le funzioni).
DO $$
BEGIN
  IF to_regprocedure('wallet_set_default(uuid,integer)') IS NULL
     OR to_regprocedure('wallet_take_user_lock(uuid)') IS NULL THEN
    RAISE EXCEPTION 'wallet_pots_precheck_failed'
      USING ERRCODE = '45000',
            DETAIL  = 'migrations/004_wallet_invariants.sql non risulta applicata';
  END IF;
END
$$;

-- 1) Colonne.
ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'account',
  ADD COLUMN IF NOT EXISTS parent_wallet_id integer REFERENCES "Wallet"(id);

COMMENT ON COLUMN "Wallet".kind IS
  '''account'' = conto; ''pot'' = salvadanaio di un conto (parent_wallet_id). Solo i conti contano nel limite di 3 e possono essere default. Migrazione 012.';
COMMENT ON COLUMN "Wallet".parent_wallet_id IS
  'Solo per kind = ''pot'': il conto a cui appartiene il salvadanaio. Migrazione 012.';

-- 2) Vincoli.
ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_kind_chk,
  ADD CONSTRAINT wallet_kind_chk CHECK (kind IN ('account', 'pot'));

ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_pot_parent_chk,
  ADD CONSTRAINT wallet_pot_parent_chk CHECK ((kind = 'pot') = (parent_wallet_id IS NOT NULL));

ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_pot_not_default_chk,
  ADD CONSTRAINT wallet_pot_not_default_chk CHECK (NOT (kind = 'pot' AND is_default));

CREATE INDEX IF NOT EXISTS idx_wallet_parent_wallet_id
  ON "Wallet" (parent_wallet_id)
  WHERE parent_wallet_id IS NOT NULL;

-- 3) Il padre di un salvadanaio e' un conto dello stesso utente.
CREATE OR REPLACE FUNCTION wallet_check_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'pot' AND NOT EXISTS (
    SELECT 1 FROM "Wallet"
    WHERE id = NEW.parent_wallet_id AND userid = NEW.userid AND kind = 'account'
  ) THEN
    RAISE EXCEPTION 'wallet_bad_parent'
      USING ERRCODE = '45005',
            DETAIL  = format('parent_wallet_id=%s non e'' un conto di userid=%s', NEW.parent_wallet_id, NEW.userid);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS wallet_check_parent_trg ON "Wallet";
CREATE TRIGGER wallet_check_parent_trg
  BEFORE INSERT OR UPDATE ON "Wallet"
  FOR EACH ROW EXECUTE FUNCTION wallet_check_parent();

-- 4a) Limite di 3 sui soli conti; primo conto default; salvadanaio mai default.
CREATE OR REPLACE FUNCTION wallet_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  IF NEW.kind = 'pot' THEN
    NEW.is_default := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM wallet_take_user_lock(NEW.userid);

    SELECT count(*) INTO n FROM "Wallet" WHERE userid = NEW.userid AND kind = 'account';

    IF n >= 3 THEN
      RAISE EXCEPTION 'wallet_limit_exceeded'
        USING ERRCODE = '45001',
              DETAIL  = format('l''utente ha gia'' %s conti, il massimo e'' 3', n),
              HINT    = 'Elimina un conto esistente. I salvadanai non contano nel limite.';
    END IF;

    IF n = 0 THEN
      NEW.is_default := true;
    ELSIF NEW.is_default THEN
      NEW.is_default := false;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND NEW.userid IS DISTINCT FROM OLD.userid THEN
    PERFORM wallet_take_user_lock(NEW.userid);

    SELECT count(*) INTO n FROM "Wallet" WHERE userid = NEW.userid AND kind = 'account';

    IF n >= 3 THEN
      RAISE EXCEPTION 'wallet_limit_exceeded'
        USING ERRCODE = '45001',
              DETAIL  = format('l''utente di destinazione ha gia'' %s conti, il massimo e'' 3', n),
              HINT    = 'Il wallet non puo'' essere assegnato a questo utente.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

-- 4b) Eliminando il default si promuove un conto, mai un salvadanaio.
CREATE OR REPLACE FUNCTION wallet_after_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  successor_id integer;
BEGIN
  IF OLD.is_default THEN
    SELECT id INTO successor_id
    FROM "Wallet"
    WHERE userid = OLD.userid AND id <> OLD.id AND kind = 'account'
    ORDER BY id
    LIMIT 1;

    IF successor_id IS NOT NULL THEN
      UPDATE "Wallet" SET is_default = true WHERE id = successor_id;
    END IF;
  END IF;

  RETURN NULL;
END
$$;

-- 5) Il default si sposta solo su un conto.
CREATE OR REPLACE FUNCTION wallet_set_default(p_userid uuid, p_wallet_id integer)
RETURNS SETOF "Wallet"
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  target_kind text;
BEGIN
  PERFORM wallet_take_user_lock(p_userid);

  SELECT kind INTO target_kind FROM "Wallet" WHERE id = p_wallet_id AND userid = p_userid;

  IF target_kind IS NULL THEN
    RAISE EXCEPTION 'wallet_not_found'
      USING ERRCODE = '45003',
            DETAIL  = format('wallet id=%s non appartiene a userid=%s', p_wallet_id, p_userid),
            HINT    = 'Verifica l''id del wallet: il default si sposta solo su un wallet proprio.';
  END IF;

  IF target_kind <> 'account' THEN
    RAISE EXCEPTION 'wallet_not_account'
      USING ERRCODE = '45004',
            DETAIL  = format('wallet id=%s e'' un salvadanaio', p_wallet_id),
            HINT    = 'Solo un conto puo'' essere il wallet di default.';
  END IF;

  UPDATE "Wallet" SET is_default = false
   WHERE userid = p_userid AND is_default AND id <> p_wallet_id;

  UPDATE "Wallet" SET is_default = true
   WHERE id = p_wallet_id AND userid = p_userid;

  RETURN QUERY
    SELECT * FROM "Wallet" WHERE id = p_wallet_id AND userid = p_userid;
END
$$;
