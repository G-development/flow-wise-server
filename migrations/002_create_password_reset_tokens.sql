-- Tabella per i token di reset password.
-- 13/11/2026: verificato che sul progetto live NON era applicata (PGRST205): il "password dimenticata"
-- non poteva funzionare. Resa idempotente (IF NOT EXISTS, DROP POLICY IF EXISTS) per applicarla senza rischi.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Enable RLS
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Policy per password_reset_tokens
DROP POLICY IF EXISTS "Users can view their own reset tokens" ON password_reset_tokens;
CREATE POLICY "Users can view their own reset tokens"
  ON password_reset_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Auto-delete expired tokens (opzionale, richiede pg_cron)
-- SELECT cron.schedule('delete-expired-reset-tokens', '0 * * * *', 
--   'DELETE FROM password_reset_tokens WHERE expires_at < NOW() AND used = false');
