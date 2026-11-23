-- CI-only local grants. Mirrors the separately approved CuevaCoin LIVE schema USAGE gate.
-- This file is executed only by the ephemeral GitHub-hosted Supabase test stack.
GRANT USAGE ON SCHEMA api, fortuna_private TO authenticated;
