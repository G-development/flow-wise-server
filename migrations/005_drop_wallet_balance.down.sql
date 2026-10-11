-- 005_drop_wallet_balance.down.sql
--
-- Rollback di `005_drop_wallet_balance.sql`: ricrea la colonna `Wallet.balance`.
--
-- Ricrea SOLO la struttura, non i valori: la colonna era un fantasma con dati discordanti
-- dal saldo derivato, non una copia da ripristinare. Il valore autorevole di ogni wallet
-- vive in `Wallet.opening_balance_cents` (migrazione 003) e nella somma delle transazioni.
-- Dopo il rollback la colonna resta quindi un residuo a 0 e va trattata come tale: non
-- reintrodurla come fonte di verita'.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS`.

ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS balance double precision DEFAULT 0;

SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Wallet'
      AND column_name = 'balance')                     AS colonna_balance,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Wallet'
      AND column_name = 'opening_balance_cents')       AS colonna_apertura;
