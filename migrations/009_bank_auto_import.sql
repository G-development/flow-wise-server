-- 009_bank_auto_import.sql
--
-- Import automatico dei movimenti bancari (job giornaliero, POST /bank/scheduler/import).
--
-- 1. bank_connections.import_wallet_id: il wallet di destinazione dell'import automatico
--    per quella banca. NULL = import automatico disattivato. Se il wallet viene
--    cancellato, l'import automatico si spegne (SET NULL) invece di bloccare la DELETE.
-- 2. bank_connections.auto_import_from: data da cui l'import automatico prende i movimenti.
--    Evita di reimportare movimenti piu' vecchi gia' entrati a mano prima che esistesse il
--    collegamento del punto 4.
-- 3. bank_transactions.booking_status: 'booked' o 'pending', come li restituisce
--    GoCardless. Prima di questa migrazione i movimenti in sospeso venivano salvati come
--    contabilizzati; l'import automatico prende solo i 'booked'. Le righe esistenti restano
--    NULL finche' una sincronizzazione non le riconferma, e con NULL non vengono importate
--    in automatico.
-- 4. Transaction.bank_transaction_id: il movimento bancario da cui e' stata importata la
--    riga. L'indice univoco impedisce di importare due volte lo stesso movimento (import
--    manuale e automatico usano INSERT ... ON CONFLICT DO NOTHING su questa colonna).
--    I NULL sono distinti in un indice univoco, quindi le righe inserite a mano non
--    collidono tra loro.
--
-- Idempotente: si puo' rieseguire. Reversibile con 009_bank_auto_import.down.sql.

ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS import_wallet_id integer
    REFERENCES public."Wallet"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_import_from date;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS booking_status varchar(10)
    CHECK (booking_status IN ('booked', 'pending'));

ALTER TABLE public."Transaction"
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid
    REFERENCES bank_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transaction_bank_transaction_id_key
  ON public."Transaction" (bank_transaction_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_auto_import
  ON bank_transactions (user_id, bank_id, account_id, status, booking_status, date);
