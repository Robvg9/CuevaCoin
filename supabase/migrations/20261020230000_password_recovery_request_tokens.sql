-- Recovery-link tokens are intentionally opaque and only readable with service_role.
-- No client role receives SELECT/INSERT/UPDATE/DELETE on this table.
CREATE TABLE IF NOT EXISTS public.password_recovery_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    profile_id uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,
    contact_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_password_recovery_requests_profile_created
    ON public.password_recovery_requests (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_recovery_requests_expiry
    ON public.password_recovery_requests (expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE public.password_recovery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_recovery_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.password_recovery_requests TO service_role;