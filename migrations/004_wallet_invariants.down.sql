-- 004_wallet_invariants.down.sql
--
-- Rollback di `004_wallet_invariants.sql`: rimuove indici, trigger e funzioni.
-- I dati non vengono toccati: dopo il rollback il limite di 3 wallet e il default
-- tornano garantiti solo dall'applicazione (`routes/wallet.js`).
--
-- Ordine obbligato: prima i trigger (che dipendono dalle funzioni), poi le funzioni.

DROP TRIGGER IF EXISTS wallet_exactly_one_default_trg ON "Wallet";
DROP TRIGGER IF EXISTS wallet_after_delete_trg ON "Wallet";
DROP TRIGGER IF EXISTS wallet_before_write_trg ON "Wallet";

DROP FUNCTION IF EXISTS wallet_set_default(uuid, integer);
DROP FUNCTION IF EXISTS wallet_assert_one_default();
DROP FUNCTION IF EXISTS wallet_after_delete();
DROP FUNCTION IF EXISTS wallet_before_write();
DROP FUNCTION IF EXISTS wallet_take_user_lock(uuid);

DROP INDEX IF EXISTS wallet_one_default_per_user_idx;

SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE tablename = 'Wallet' AND indexname = 'wallet_one_default_per_user_idx') AS unique_default_index,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = '"Wallet"'::regclass AND NOT tgisinternal)                       AS triggers,
  (SELECT count(*) FROM pg_proc
    WHERE proname IN ('wallet_set_default', 'wallet_assert_one_default',
                      'wallet_after_delete', 'wallet_before_write',
                      'wallet_take_user_lock'))                                      AS functions_left;
