-- 005_drop_wallet_balance.sql
--
-- Rimuove la colonna fantasma `Wallet.balance`.
--
-- Perche': il saldo di un wallet non e' memorizzato, e' DERIVATO dalle transazioni
-- (`utils/walletService.js`): `opening_balance_cents` (migrazione 003) e' il punto di
-- partenza, i movimenti in `Transaction` il resto. La colonna `balance` era la vecchia
-- fonte di verita' e nessun percorso la teneva allineata: restava a 0 alla creazione e
-- valeva un numero diverso dal saldo mostrato (misurato prima di 003: 3 wallet su 5 con
-- stored != derived, delta massimo 13264.23 EUR). Ogni valore utile e' gia' stato
-- trasferito in `opening_balance_cents` dal backfill di 003, quindi la colonna e' ora un
-- residuo: dopo questo file nessun percorso server la legge, la scrive o la espone
-- (routes/wallet.js, routes/user.js e utils/bankService.js sono gia' allineati).
--
-- Sicura su DB con dati discordanti: non legge ne' confronta i valori, quindi non dipende
-- dall'allineamento tra stored e derivato. Nessuna view, policy o dipendenza Postgres
-- referenzia la colonna (verificato su pg_depend, pg_views e pg_policy), quindi il drop
-- non rompe alcun oggetto di schema.
--
-- Idempotente: `DROP COLUMN IF EXISTS` non fa nulla se la colonna e' gia' assente, quindi
-- rieseguire il file su un DB gia' migrato e' un no-op.
--
-- ONWARD: il rollback e' in `005_drop_wallet_balance.down.sql` (convenzione di
-- `004_wallet_invariants`). Il down ricrea la colonna con il suo default, NON i suoi
-- valori: era un fantasma con dati discordanti, non una copia da ripristinare. Il valore
-- autorevole del wallet vive in `opening_balance_cents`.
--
-- NOTA sull'ordine: `003_wallet_opening_balance.sql` legge `Wallet.balance` per calcolare
-- il backfill, quindi va eseguita PRIMA di questo file. Dopo il drop, rieseguire 003 non e'
-- supportato (fallirebbe con `column "balance" does not exist`): il suo backfill e' gia'
-- stato applicato una volta e l'apertura vive in `Wallet.opening_balance_cents`.

ALTER TABLE "Wallet" DROP COLUMN IF EXISTS balance;

-- Esito del drop (una riga, per il report di chi esegue la migrazione).
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Wallet'
      AND column_name = 'balance')                     AS colonna_balance,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Wallet'
      AND column_name = 'opening_balance_cents')       AS colonna_apertura;
