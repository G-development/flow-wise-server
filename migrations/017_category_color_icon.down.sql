-- Annulla la 017: toglie colore e icona delle categorie.
ALTER TABLE public."Category" DROP CONSTRAINT IF EXISTS category_color_format_chk;
ALTER TABLE public."Category" DROP CONSTRAINT IF EXISTS category_icon_format_chk;
ALTER TABLE public."Category" DROP COLUMN IF EXISTS color, DROP COLUMN IF EXISTS icon;
