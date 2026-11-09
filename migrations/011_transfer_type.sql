-- 011_transfer_type.sql
--
-- Trasferimenti tra wallet (tipo 'T'): giroconti conto <-> salvadanaio e conto <-> conto.
-- Progetto in TODO_SALVADANAI.md, sezione "Progetto del tipo T".
--
-- L'enum di `Transaction.type` e `Category.type` ("I / E / T") ammette gia' 'T': questa
-- migrazione aggiunge solo cio' che manca perche' una 'T' abbia senso.
--
-- 1. Transaction.to_wallet_id: il wallet di destinazione. Una 'T' sposta `amount` (>= 0) da
--    `wallet_id` (origine) a `to_wallet_id` (destinazione). Nessuna azione ON DELETE, come
--    `wallet_id`: un wallet con trasferimenti non si elimina.
-- 2. Vincoli di coerenza:
--    - 'I' ed 'E' hanno sempre `wallet_id` e mai `to_wallet_id`;
--    - una 'T' ha almeno un lato e, se li ha entrambi, sono diversi. Un lato vuoto e' un
--      trasferimento "da assegnare": dalla banca si conosce il conto ma non il salvadanaio, e
--      il lato mancante puo' essere l'origine ("Riunione somme dal salvadanaio") o la
--      destinazione ("Accantonamento somma sul Salvadanaio").
--    Che i due wallet siano dell'utente della transazione lo controlla la route, come per
--    `wallet_id` oggi.
-- 3. Indice parziale su `to_wallet_id` (saldo dei wallet, guardia di eliminazione).
-- 4. Una sola categoria di tipo 'T' per utente (indice unico parziale): e' la categoria di
--    sistema "Trasferimento", riconoscibile dal tipo senza colonne in piu'.
-- 5. La categoria "Trasferimento" creata per ogni utente che non ce l'ha. Gli utenti nuovi la
--    ricevono alla registrazione (routes/user.js).
--
-- Innocua per il codice gia' pubblicato: non esistono righe 'T' e quel codice non legge
-- `to_wallet_id`. La categoria nuova compare pero' nelle liste delle categorie: il client
-- attuale la mostrerebbe come una categoria qualsiasi, quindi va pubblicata insieme al codice
-- che la gestisce, o subito prima.
--
-- Il pre-check ferma la migrazione senza applicare nulla se i dati violano i vincoli nuovi.
-- Idempotente; reversibile con 011_transfer_type.down.sql.

-- 0) Pre-check.
DO $$
DECLARE
  n_ie_without_wallet integer;
  n_t_rows            integer;
  n_t_categories      integer;
BEGIN
  SELECT count(*) INTO n_ie_without_wallet
  FROM public."Transaction" WHERE type IN ('I', 'E') AND wallet_id IS NULL;

  SELECT count(*) INTO n_t_rows
  FROM public."Transaction" WHERE type = 'T';

  SELECT count(*) INTO n_t_categories
  FROM (SELECT userid FROM public."Category" WHERE type = 'T'
        GROUP BY userid HAVING count(*) > 1) s;

  IF n_ie_without_wallet > 0 OR n_t_categories > 0 THEN
    RAISE EXCEPTION 'transfer_type_precheck_failed'
      USING ERRCODE = '45000',
            DETAIL  = format('I/E senza wallet: %s; utenti con 2+ categorie T: %s',
                             n_ie_without_wallet, n_t_categories);
  END IF;

  -- Righe 'T' preesistenti senza `to_wallet_id` non sono un errore: hanno l'origine e
  -- risultano "da assegnare". Le segnaliamo soltanto.
  IF n_t_rows > 0 THEN
    RAISE NOTICE 'transfer_type: % righe T gia'' presenti', n_t_rows;
  END IF;
END
$$;

-- 1) Wallet di destinazione.
ALTER TABLE public."Transaction"
  ADD COLUMN IF NOT EXISTS to_wallet_id integer REFERENCES public."Wallet"(id);

COMMENT ON COLUMN public."Transaction".to_wallet_id IS
  'Solo per type = ''T'': wallet di destinazione (wallet_id e'' l''origine). NULL = lato da assegnare. Migrazione 011.';

-- 2) Vincoli di coerenza.
ALTER TABLE public."Transaction"
  DROP CONSTRAINT IF EXISTS transaction_income_expense_wallets_chk,
  ADD CONSTRAINT transaction_income_expense_wallets_chk
    CHECK (type = 'T' OR (wallet_id IS NOT NULL AND to_wallet_id IS NULL));

ALTER TABLE public."Transaction"
  DROP CONSTRAINT IF EXISTS transaction_transfer_wallets_chk,
  ADD CONSTRAINT transaction_transfer_wallets_chk
    CHECK (
      type <> 'T'
      OR (
        (wallet_id IS NOT NULL OR to_wallet_id IS NOT NULL)
        AND wallet_id IS DISTINCT FROM to_wallet_id
      )
    );

-- 3) Indice sulla destinazione.
CREATE INDEX IF NOT EXISTS idx_transaction_to_wallet_id
  ON public."Transaction" (to_wallet_id)
  WHERE to_wallet_id IS NOT NULL;

-- 4) Una sola categoria T per utente.
CREATE UNIQUE INDEX IF NOT EXISTS category_one_transfer_per_user_idx
  ON public."Category" (userid)
  WHERE type = 'T';

COMMENT ON INDEX category_one_transfer_per_user_idx IS
  'Al massimo una Category di tipo T per userid: la categoria di sistema "Trasferimento". Migrazione 011.';

-- 5) Categoria "Trasferimento" per gli utenti esistenti.
INSERT INTO public."Category" (name, type, userid, active)
SELECT 'Trasferimento', 'T', u.id, true
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public."Category" c WHERE c.userid = u.id AND c.type = 'T'
);
