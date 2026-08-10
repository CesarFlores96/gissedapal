BEGIN;

-- Refresh tokens de sesión local (reemplaza los refresh tokens de Supabase
-- Auth): opacos, se guarda solo su hash SHA-256, nunca el valor crudo.
-- public.users ya existe con password_hash (scrypt) desde la infraestructura
-- de D:\BD_LOCAL\api-fastapi; esta tabla es lo único nuevo que necesita el
-- login local de SEDAPAL GIS.
CREATE TABLE IF NOT EXISTS public.auth_refresh_tokens (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id
  ON public.auth_refresh_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at
  ON public.auth_refresh_tokens (expires_at);

COMMIT;
