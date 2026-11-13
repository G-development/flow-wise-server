-- Annulla la 016: la categoria di sistema torna "Trasferimento".
UPDATE public."Category"
SET name = 'Trasferimento'
WHERE type = 'T' AND name = 'Transfer';
