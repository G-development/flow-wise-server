-- 003_wallet_opening_balance.sql
--
-- Saldo di apertura esplicito per Wallet.
--
-- Perche': il saldo di un wallet non e' memorizzato, e' derivato dalle transazioni
-- (`utils/walletService.js`, `sumBalancesInCents`). La somma vale solo se ogni movimento
-- dalla nascita del wallet e' nel DB; con uno storico importato il punto di partenza manca
-- e il saldo scende sotto zero (misurato prima di questa migrazione: wallet "GC Default
-- wallet" stored 0.00 | derived -13264.23, Total Balance -11414.23). Questa colonna e' quel
-- punto di partenza, persistito e modificabile dall'utente dalla pagina /wallets.
--
-- Unita': centesimi interi (integer), come la somma in `walletService.js`. Il saldo in EUR
-- e' `opening_balance_cents / 100`. Il nome segue la convenzione della tabella
-- (`userid`, `is_default`) e viene restituito cosi' com'e' dalle API: nessun alias camelCase.
--
-- Criterio del backfill (non silenzioso, un wallet per riga nel report finale):
--   opening_balance_cents = round(Wallet.balance * 100) - somma_movimenti_in_centesimi
-- quindi il saldo derivato coincide con il `balance` memorizzato oggi, che e' il miglior
-- valore noto del wallet. Non e' uno zero di comodo: i wallet che avevano un `balance`
-- diverso dalla somma dei movimenti ricevono un valore diverso da zero e tracciato.
-- I wallet creati dopo questa migrazione partono dal default 0, che per un wallet senza
-- storico e' la risposta corretta (la somma dei movimenti e' gia' il saldo intero).
-- Se `balance` e' NULL il valore non e' calcolabile: l'apertura viene posta a
-- -somma_movimenti (il wallet legge 0.00, il default neutro) e il report lo marca
-- `non_calcolabile = true` perche' venga corretto a mano.
--
-- Idempotente: rieseguire il file ricalcola lo stesso valore e riporta `toccato = false`.
-- Il log completo (wallet toccati e valori) e' l'ultima SELECT del file; la stessa regola
-- e' implementata in `backfill-opening-balance.mjs` per l'esecuzione da terminale.

ALTER TABLE "Wallet"
  ADD COLUMN IF NOT EXISTS opening_balance_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN "Wallet".opening_balance_cents IS
  'Saldo di apertura del wallet in centesimi (integer NOT NULL, default 0). Punto di partenza della somma derivata in utils/walletService.js; modificabile dall''utente.';

WITH movimenti AS (
  SELECT
    t.wallet_id,
    COALESCE(
      SUM(
        CASE
          WHEN t.type = 'I' THEN round(abs(t.amount) * 100)::bigint
          ELSE -round(abs(t.amount) * 100)::bigint
        END
      ),
      0
    )::bigint AS movements_cents
  FROM "Transaction" t
  GROUP BY t.wallet_id
),
obiettivo AS (
  SELECT
    w.id,
    w.name,
    w.userid,
    w.balance AS stored_balance,
    COALESCE(m.movements_cents, 0) AS movements_cents,
    w.opening_balance_cents AS current_opening_cents,
    CASE
      WHEN w.balance IS NULL THEN -COALESCE(m.movements_cents, 0)
      ELSE round(w.balance * 100)::bigint - COALESCE(m.movements_cents, 0)
    END AS opening_cents,
    (w.balance IS NULL) AS non_calcolabile
  FROM "Wallet" w
  LEFT JOIN movimenti m ON m.wallet_id = w.id
),
toccati AS (
  UPDATE "Wallet" w
  SET opening_balance_cents = o.opening_cents
  FROM obiettivo o
  WHERE w.id = o.id
    AND w.opening_balance_cents IS DISTINCT FROM o.opening_cents
  RETURNING w.id AS id, w.opening_balance_cents AS opening_cents
)
SELECT
  o.id,
  o.name,
  o.stored_balance,
  o.movements_cents / 100.0 AS movements,
  COALESCE(t.opening_cents, o.current_opening_cents) AS opening_balance_cents,
  (COALESCE(t.opening_cents, o.current_opening_cents) + o.movements_cents) / 100.0
    AS derived_balance,
  (
    round(COALESCE(o.stored_balance, 0) * 100)::bigint
    = COALESCE(t.opening_cents, o.current_opening_cents) + o.movements_cents
  ) AS invariant_ok,
  o.non_calcolabile,
  (t.id IS NOT NULL) AS toccato
FROM obiettivo o
LEFT JOIN toccati t ON t.id = o.id
ORDER BY o.id;
