-- Annulla la 018: ricrea "Saving" vuota, con le colonne che aveva (lette dallo schema dell'API il 14/11/2026).
CREATE TABLE IF NOT EXISTS public."Saving" (
  id serial PRIMARY KEY,
  name text NOT NULL,
  targetamount double precision NOT NULL,
  currentamount double precision DEFAULT 0,
  userid uuid NOT NULL DEFAULT auth.uid(),
  walletid integer NOT NULL REFERENCES public."Wallet"(id)
);
