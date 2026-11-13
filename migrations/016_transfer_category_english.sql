-- Migrazione 016 (13/11/2026): la categoria di sistema dei trasferimenti si chiama "Transfer".
--
-- L'interfaccia e' tutta in inglese dall'11/11 e la categoria di tipo `T` e' di sistema (una per
-- utente, migrazione 011): il suo nome lo decide l'app, non l'utente. Il codice la riconosce dal
-- tipo, mai dal nome, quindi rinominarla non cambia nessun comportamento.
-- Rinomina solo chi ha ancora il nome di prima: se un utente l'avesse rinominata, resta com'e'.
-- Idempotente: la seconda volta non trova piu' righe da cambiare.

UPDATE public."Category"
SET name = 'Transfer'
WHERE type = 'T' AND name = 'Trasferimento';
