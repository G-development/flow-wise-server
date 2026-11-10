-- 012_wallet_pots.down.sql
--
-- Annulla 012_wallet_pots.sql e ripristina le funzioni della 004. Si ferma senza toccare
-- nulla se esistono salvadanai: togliere `kind` li trasformerebbe in conti, oltre il limite
-- di 3 e con i trasferimenti che puntano a loro.

DO $$
DECLARE
  n_pots integer;
BEGIN
  SELECT count(*) INTO n_pots FROM "Wallet" WHERE kind = 'pot';
  IF n_pots > 0 THEN
    RAISE EXCEPTION 'wallet_pots_down_blocked'
      USING ERRCODE = '45000',
            DETAIL  = format('%s salvadanai esistenti: eliminarli prima del rollback', n_pots);
  END IF;
END
$$;

DROP TRIGGER IF EXISTS wallet_check_parent_trg ON "Wallet";
DROP FUNCTION IF EXISTS wallet_check_parent();

-- Funzioni della 004, com'erano.
CREATE OR REPLACE FUNCTION wallet_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM wallet_take_user_lock(NEW.userid);
    SELECT count(*) INTO n FROM "Wallet" WHERE userid = NEW.userid;
    IF n >= 3 THEN
      RAISE EXCEPTION 'wallet_limit_exceeded'
        USING ERRCODE = '45001',
              DETAIL  = format('l''utente ha gia'' %s wallet, il massimo e'' 3', n),
              HINT    = 'Elimina un wallet esistente. Il limite e'' un invariante del DB.';
    END IF;
    IF n = 0 THEN
      NEW.is_default := true;
    ELSIF NEW.is_default THEN
      NEW.is_default := false;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.userid IS DISTINCT FROM OLD.userid THEN
    PERFORM wallet_take_user_lock(NEW.userid);
    SELECT count(*) INTO n FROM "Wallet" WHERE userid = NEW.userid;
    IF n >= 3 THEN
      RAISE EXCEPTION 'wallet_limit_exceeded'
        USING ERRCODE = '45001',
              DETAIL  = format('l''utente di destinazione ha gia'' %s wallet, il massimo e'' 3', n),
              HINT    = 'Il wallet non puo'' essere assegnato a questo utente.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

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
    WHERE userid = OLD.userid AND id <> OLD.id
    ORDER BY id
    LIMIT 1;
    IF successor_id IS NOT NULL THEN
      UPDATE "Wallet" SET is_default = true WHERE id = successor_id;
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION wallet_set_default(p_userid uuid, p_wallet_id integer)
RETURNS SETOF "Wallet"
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM wallet_take_user_lock(p_userid);
  IF NOT EXISTS (
    SELECT 1 FROM "Wallet" WHERE id = p_wallet_id AND userid = p_userid
  ) THEN
    RAISE EXCEPTION 'wallet_not_found'
      USING ERRCODE = '45003',
            DETAIL  = format('wallet id=%s non appartiene a userid=%s', p_wallet_id, p_userid),
            HINT    = 'Verifica l''id del wallet: il default si sposta solo su un wallet proprio.';
  END IF;
  UPDATE "Wallet" SET is_default = false
   WHERE userid = p_userid AND is_default AND id <> p_wallet_id;
  UPDATE "Wallet" SET is_default = true
   WHERE id = p_wallet_id AND userid = p_userid;
  RETURN QUERY
    SELECT * FROM "Wallet" WHERE id = p_wallet_id AND userid = p_userid;
END
$$;

DROP INDEX IF EXISTS idx_wallet_parent_wallet_id;

ALTER TABLE "Wallet"
  DROP CONSTRAINT IF EXISTS wallet_pot_not_default_chk,
  DROP CONSTRAINT IF EXISTS wallet_pot_parent_chk,
  DROP CONSTRAINT IF EXISTS wallet_kind_chk;

ALTER TABLE "Wallet"
  DROP COLUMN IF EXISTS parent_wallet_id,
  DROP COLUMN IF EXISTS kind;
