-- Annulla la 019: ricrea "dashboard_layouts" vuota, come era sul live (schema letto il 22/11/2026).
-- Le righe cancellate non tornano.

CREATE TABLE IF NOT EXISTS public.dashboard_layouts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_user_layout UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_user_id ON public.dashboard_layouts (user_id);

ALTER TABLE public.dashboard_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own layouts" ON public.dashboard_layouts;
DROP POLICY IF EXISTS "Users can insert own layouts" ON public.dashboard_layouts;
DROP POLICY IF EXISTS "Users can update own layouts" ON public.dashboard_layouts;
DROP POLICY IF EXISTS "Users can delete own layouts" ON public.dashboard_layouts;
CREATE POLICY "Users can view own layouts" ON public.dashboard_layouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own layouts" ON public.dashboard_layouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own layouts" ON public.dashboard_layouts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own layouts" ON public.dashboard_layouts FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_dashboard_layouts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_update_dashboard_layouts_updated_at ON public.dashboard_layouts;
CREATE TRIGGER trigger_update_dashboard_layouts_updated_at
  BEFORE UPDATE ON public.dashboard_layouts
  FOR EACH ROW EXECUTE FUNCTION public.update_dashboard_layouts_updated_at();
