-- 004_wallet_invariants.sql
--
-- Invarianti di "Wallet" garantiti dal DATABASE, non dalla sola applicazione:
--   (a) massimo 3 wallet per utente;
--   (b) always-esattamente-un wallet di default per ogni utente che possiede wallet:
--       il primo wallet e' il default, il cambio di default e' atomico e nessun commit
--       puo' lasciare un utente con zero (o due) default.
--
-- Perche': fino a questa migrazione il limite viveva solo in `routes/wallet.js`
-- (`select count(*)` seguito da `insert`: due POST paralleli entrambi con count=2
-- passavano il controllo e creavano il quarto wallet) e il cambio di default era
-- composto da due UPDATE separati (azzera tutti, poi setta il richiesto): se il
-- secondo falliva l'utente restava senza default. Misurato il 2026-10-11: 5 wallet,
-- 4 utenti, max 2 wallet per utente, 0 utenti senza default -> difetto latente.
--
-- Meccanismi (PostgreSQL >= 12: Supabase gira su 15+; usati solo costrutti disponibili
-- da 9.5/11 in su, nessuna estensione richiesta):
--   1. indice unico parziale `wallet_one_default_per_user_idx` su (userid) WHERE is_default
--      -> al massimo un default per utente, garantito strutturalmente e senza race.
--   2. trigger BEFORE INSERT/UPDATE `wallet_before_write_trg`
--      -> limite di 3 wallet per utente e primo wallet forzato a default.
--      Il conteggio e' reso affidabile sotto concorrenza da un advisory lock
--      per utente (`pg_advisory_xact_lock`, reentrant, rilasciato a fine transazione):
--      la seconda INSERT attende il commit della prima e conta lo stato aggiornato.
--      Verificato il 2026-10-11 su PostgreSQL 18.3 con 8 inserimenti concorrenti reali
--      (barriera sincronizzata): senza lock 4 successi su 8 e 6 wallet finali con
--      partenza da 2, con il lock 1 successo su 8 e 3 wallet finali.
--   3. trigger AFTER DELETE `wallet_after_delete_trg`
--      -> se si elimina il default e restano altri wallet, ne promuove uno: eliminare
--      il wallet di default continua a funzionare e l'invariante resta vero.
--   4. constraint trigger DEFERRABLE INITIALLY DEFERRED `wallet_exactly_one_default_trg`
--      -> al COMMIT, per ogni utente toccato che possiede ancora wallet, il default deve
--      esistere ed essere esattamente uno. E' il meccanismo che rende sicura la sequenza
--      "azzera tutti + setta quello richiesto" (nessuno stato *committato* con zero
--      default) e che riporta un errore se si tenta di azzerare l'ultimo default.
--   5. funzione RPC `wallet_set_default(p_userid uuid, p_wallet_id integer)`
--      -> il cambio di default in una sola operazione atomica: prima azzera i default
--      degli altri wallet dell'utente, poi setta quello richiesto. Un solo giro di rete,
--      nessun intervallo con zero default visibile o committabile.
--
-- Codici d'errore riconoscibili dalle route (SQLSTATE, classe 45 = user-defined):
--   45001  wallet_limit_exceeded   quarto wallet per lo stesso utente
--   45002  wallet_default_missing  commit senza default per un utente che ha wallet
--   45003  wallet_not_found        wallet inesistente o non dell'utente (RPC)
--   23505  unique_violation su wallet_one_default_per_user_idx  secondo default esplicito
-- Il MESSAGGIO dell'eccezione coincide con l'identificatore (`wallet_limit_exceeded`, ...):
-- PostgREST lo restituisce in `error.message` (e lo SQLSTATE in `error.code`), quindi la
-- route puo' mappare il limite su HTTP 409 senza ispezionare il testo dell'errore.
--
-- Ordine di esecuzione: il blocco di pre-check e' la prima istruzione, quindi una base
-- dati che viola gia' l'invariante fa fallire la migrazione senza applicare nulla.
-- Tutti gli oggetti sono creati con IF NOT EXISTS / OR REPLACE / DROP IF EXISTS:
-- rieseguire il file e' idempotente.
-- Rollback: `migrations/004_wallet_invariants.down.sql`.

-- 0) Pre-check: se i dati attuali violano l'invariante, la migrazione si ferma qui.
DO $$
DECLARE
  n_over  integer;
  n_none  integer;
  n_multi integer;
BEGIN
  SELECT count(*) INTO n_over
  FROM (SELECT userid FROM "Wallet" GROUP BY userid HAVING count(*) > 3) s;

  SELECT count(*) INTO n_none
  FROM (SELECT userid FROM "Wallet" GROUP BY userid
        HAVING count(*) FILTER (WHERE is_default) = 0) s;

  SELECT count(*) INTO n_multi
  FROM (SELECT userid FROM "Wallet" GROUP BY userid
        HAVING count(*) FILTER (WHERE is_default) > 1) s;

  IF n_over > 0 OR n_none > 0 OR n_multi > 0 THEN
    RAISE EXCEPTION 'wallet_invariants_precheck_failed'
      USING ERRCODE = '45000',
            DETAIL  = format('utenti con piu di 3 wallet: %s; utenti con wallet ma 0 default: %s; utenti con 2+ default: %s',
                             n_over, n_none, n_multi),
            HINT    = 'Normalizza i dati prima di applicare: '
                      'SELECT userid, count(*) FROM "Wallet" GROUP BY userid HAVING count(*) > 3; '
                      'SELECT userid FROM "Wallet" GROUP BY userid HAVING count(*) FILTER (WHERE is_default) <> 1;';
  END IF;
END
$$;

-- 1) Al massimo un default per utente (vincolo strutturale, immediato).
CREATE UNIQUE INDEX IF NOT EXISTS wallet_one_default_per_user_idx
  ON "Wallet" (userid)
  WHERE is_default;

COMMENT ON INDEX wallet_one_default_per_user_idx IS
  'Al massimo un Wallet.is_default = true per userid. Invariante garantito dal DB (migrazione 004).';

-- 2) Lock consultivo per utente: serializza il conteggio dei wallet dello stesso utente
--    tra transazioni concorrenti. Reentrant nella stessa transazione; hash a 64 bit con
--    seed fisso, una collisione fra utenti diversi costa solo serializzazione in piu'.
CREATE OR REPLACE FUNCTION wallet_take_user_lock(p_userid uuid)
RETURNS void
LANGUAGE sql
VOLATILE
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(p_userid::text, 0));
$$;

-- 3) Limite di 3 wallet per utente + primo wallet sempre default.
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
      -- Primo wallet dell'utente: e' il default per definizione.
      NEW.is_default := true;
    ELSIF NEW.is_default THEN
      -- Un solo default per utente: per spostarlo serve wallet_set_default().
      NEW.is_default := false;
    END IF;

  ELSIF TG_OP = 'UPDATE' AND NEW.userid IS DISTINCT FROM OLD.userid THEN
    -- Cambio di proprietario: vale il limite dell'utente di destinazione.
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

DROP TRIGGER IF EXISTS wallet_before_write_trg ON "Wallet";
CREATE TRIGGER wallet_before_write_trg
  BEFORE INSERT OR UPDATE ON "Wallet"
  FOR EACH ROW EXECUTE FUNCTION wallet_before_write();

-- 4) Eliminazione del default: promuove un altro wallet, cosi' l'utente non resta scoperto.
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

DROP TRIGGER IF EXISTS wallet_after_delete_trg ON "Wallet";
CREATE TRIGGER wallet_after_delete_trg
  AFTER DELETE ON "Wallet"
  FOR EACH ROW EXECUTE FUNCTION wallet_after_delete();

-- 5) Al COMMIT: ogni utente toccato che possiede wallet ha esattamente un default.
CREATE OR REPLACE FUNCTION wallet_assert_one_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  uid     uuid;
  n_w     integer;
  n_def   integer;
BEGIN
  -- Un UPDATE puo' spostare un wallet fra utenti: vanno verificati entrambi.
  FOREACH uid IN ARRAY (
    CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.userid]
      WHEN 'DELETE' THEN ARRAY[OLD.userid]
      ELSE (CASE WHEN NEW.userid IS DISTINCT FROM OLD.userid
                 THEN ARRAY[OLD.userid, NEW.userid]
                 ELSE ARRAY[NEW.userid] END)
    END
  )
  LOOP
    SELECT count(*), count(*) FILTER (WHERE is_default)
      INTO n_w, n_def
    FROM "Wallet"
    WHERE userid = uid;

    IF n_w > 0 AND n_def <> 1 THEN
      RAISE EXCEPTION 'wallet_default_missing'
        USING ERRCODE = '45002',
              DETAIL  = format('userid=%s: %s wallet, %s di default', uid, n_w, n_def),
              HINT    = 'Usa wallet_set_default(userid, wallet_id) per spostare il default; '
                        'un utente con wallet deve averne esattamente uno.';
    END IF;
  END LOOP;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS wallet_exactly_one_default_trg ON "Wallet";
CREATE CONSTRAINT TRIGGER wallet_exactly_one_default_trg
  AFTER INSERT OR UPDATE OR DELETE ON "Wallet"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wallet_assert_one_default();

-- 6) Cambio di default in una sola operazione atomica.
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

  -- Azzera gli altri, poi setta quello richiesto: stessa transazione, nessuno
  -- stato committato con zero default (garantito anche dal constraint trigger).
  UPDATE "Wallet" SET is_default = false
   WHERE userid = p_userid AND is_default AND id <> p_wallet_id;

  UPDATE "Wallet" SET is_default = true
   WHERE id = p_wallet_id AND userid = p_userid;

  RETURN QUERY
    SELECT * FROM "Wallet" WHERE id = p_wallet_id AND userid = p_userid;
END
$$;

-- La RPC e' superficie interna del server (service_role), non del browser: Supabase
-- concede EXECUTE a PUBLIC/anon/authenticated per default, quindi si revoca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION wallet_set_default(uuid, integer) FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION wallet_set_default(uuid, integer) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION wallet_set_default(uuid, integer) FROM authenticated';
    END IF;
    EXECUTE 'GRANT EXECUTE ON FUNCTION wallet_set_default(uuid, integer) TO service_role';
  END IF;
END
$$;

-- 7) Report finale (il log dell'applicazione della migrazione).
SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'Wallet' AND indexname = 'wallet_one_default_per_user_idx') AS unique_default_index,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = '"Wallet"'::regclass AND NOT tgisinternal)                       AS triggers,
  (SELECT count(*) FROM (
     SELECT userid FROM "Wallet" GROUP BY userid HAVING count(*) > 3) s)             AS users_over_limit,
  (SELECT count(*) FROM (
     SELECT userid FROM "Wallet" GROUP BY userid
     HAVING count(*) FILTER (WHERE is_default) <> 1) s)                              AS users_with_wrong_default_count;
