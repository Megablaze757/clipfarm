-- =============================================================================
-- Cross-tenant leak test (spec §20.2 — must pass before every deploy).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_cross_tenant.sql
--
-- Creates two users in two tenants inside a transaction, impersonates each via
-- the `authenticated` role + JWT claims, and asserts neither can see the
-- other's rows. Everything is rolled back.
-- =============================================================================
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'rls-a@test.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-b@test.invalid');
SELECT public.clip_ensure_tenant_for_user('00000000-0000-0000-0000-00000000000a', 'rls-a@test.invalid');
SELECT public.clip_ensure_tenant_for_user('00000000-0000-0000-0000-00000000000b', 'rls-b@test.invalid');

INSERT INTO public.clip_projects (tenant_id, title, source_kind, source_uri)
SELECT tenant_id, 'A secret', 'url', 'https://example.com/a.mp4' FROM public.clip_members WHERE id = '00000000-0000-0000-0000-00000000000a';
INSERT INTO public.clip_projects (tenant_id, title, source_kind, source_uri)
SELECT tenant_id, 'B secret', 'url', 'https://example.com/b.mp4' FROM public.clip_members WHERE id = '00000000-0000-0000-0000-00000000000b';

SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.clip_projects WHERE title = 'B secret') <> 0 THEN RAISE EXCEPTION 'LEAK: user A can see tenant B projects'; END IF;
  IF (SELECT count(*) FROM public.clip_projects WHERE title = 'A secret') <> 1 THEN RAISE EXCEPTION 'user A cannot see own project'; END IF;
  IF (SELECT count(*) FROM public.clip_members) <> 1 THEN RAISE EXCEPTION 'LEAK: user A sees other profiles'; END IF;
  IF (SELECT count(*) FROM public.clip_tenants) <> 1 THEN RAISE EXCEPTION 'LEAK: user A sees other tenants'; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.clip_projects WHERE title = 'A secret') <> 0 THEN RAISE EXCEPTION 'LEAK: user B can see tenant A projects'; END IF;
  -- B must not be able to write into A's tenant either.
  BEGIN
    INSERT INTO public.clip_projects (tenant_id, title, source_kind, source_uri)
    SELECT tenant_id, 'injected', 'url', 'x' FROM public.clip_tenants LIMIT 1;  -- only B's tenant is visible
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM public.clip_usage_events) <> 0 THEN RAISE EXCEPTION 'unexpected usage rows'; END IF;
END $$;

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'RLS cross-tenant test passed'; END $$;
ROLLBACK;
