-- Migrazione 019 (22/11/2026): toglie la tabella "dashboard_layouts" e la sua funzione di trigger.
-- Serviva alla griglia personalizzabile della dashboard, sostituita il 16/11/2026 da una pagina fissa:
-- il client non la legge piu' da allora e il server ha tolto `GET`/`PUT /dashboard-layout` con questa
-- migrazione. Sul live aveva 2 righe (vecchi layout di widget, nessun dato finanziario); Gio ha deciso di
-- cancellarle con la tabella.
--
-- Idempotente. Rollback (ricrea la tabella vuota, con indici, policy RLS e trigger) nel .down.sql.

DROP TABLE IF EXISTS public.dashboard_layouts;
DROP FUNCTION IF EXISTS public.update_dashboard_layouts_updated_at();
