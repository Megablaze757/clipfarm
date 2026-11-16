-- =============================================================================
-- Clipper inside PocketAthlete's Supabase project (txqhstackgidjqkkrzyj).
--
-- Safe to run more than once. Touches NOTHING of PocketAthlete's: every object
-- here is prefixed clip_, there is no trigger on auth.users (a Clipper
-- workspace is created on a user's first Clipper API call), and PocketAthlete's
-- profiles / subscriptions tables are left alone.
--
-- Run it: Supabase dashboard → SQL editor → paste → Run. Or let the
-- "Deploy apex-api Worker + Container" GitHub Action run it (needs the
-- SUPABASE_ACCESS_TOKEN repo secret).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- Tables ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clip_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  stripe_customer_id text UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Clipper's own membership table (PocketAthlete's `profiles` is separate).
CREATE TABLE IF NOT EXISTS public.clip_members (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  source_kind text NOT NULL,
  source_uri text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  options jsonb NOT NULL DEFAULT '{}',
  idempotency_key text,
  dispatched_at timestamptz,
  progress numeric(5,2) NOT NULL DEFAULT 0,
  duration_ms int,
  language text,
  error_code text,
  error_detail text,
  loudness_json jsonb,
  model_versions jsonb,
  poster_key text,
  review_proxy_key text,
  candidate_count int NOT NULL DEFAULT 0,
  top_score numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS clip_projects_tenant_created ON public.clip_projects (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clip_projects_status ON public.clip_projects (status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clip_projects_idempotency ON public.clip_projects (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.clip_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.clip_projects(id) ON DELETE CASCADE,
  stage text NOT NULL,
  uri text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  model_versions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage)
);

CREATE TABLE IF NOT EXISTS public.clip_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL UNIQUE REFERENCES public.clip_projects(id) ON DELETE CASCADE,
  words jsonb NOT NULL,
  segments jsonb NOT NULL,
  speakers jsonb NOT NULL DEFAULT '[]',
  language text,
  edited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.clip_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.clip_projects(id) ON DELETE CASCADE,
  t_in_ms int NOT NULL,
  t_out_ms int NOT NULL,
  score numeric(5,2) NOT NULL DEFAULT 0,
  subscores jsonb NOT NULL DEFAULT '{}',
  features jsonb NOT NULL DEFAULT '{}',
  rationale text,
  proxy_uri text,
  scorer_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clip_candidates_project_score ON public.clip_candidates (project_id, score DESC);

CREATE TABLE IF NOT EXISTS public.clip_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.clip_candidates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  title text,
  t_in_ms int NOT NULL,
  t_out_ms int NOT NULL,
  edits jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS public.clip_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.clip_clips(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  preset text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  spec jsonb,
  uri text,
  error_code text,
  error_detail text,
  duration_ms int,
  container_ms int,
  queued_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS clip_render_jobs_clip ON public.clip_render_jobs (clip_id, queued_at DESC);

CREATE TABLE IF NOT EXISTS public.clip_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.clip_clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signal text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'inactive',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.clip_projects(id) ON DELETE SET NULL,
  kind text NOT NULL,
  quantity numeric NOT NULL,
  stripe_meter_event_id text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clip_brandkits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.clip_tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  fonts jsonb, colors jsonb, caption_style jsonb,
  logo_uri text, intro_uri text, outro_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- --- updated_at -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clip_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS clip_projects_touch ON public.clip_projects;
CREATE TRIGGER clip_projects_touch BEFORE UPDATE ON public.clip_projects FOR EACH ROW EXECUTE FUNCTION public.clip_touch_updated_at();
DROP TRIGGER IF EXISTS clip_clips_touch ON public.clip_clips;
CREATE TRIGGER clip_clips_touch BEFORE UPDATE ON public.clip_clips FOR EACH ROW EXECUTE FUNCTION public.clip_touch_updated_at();

-- --- Functions (service role only) ------------------------------------------
CREATE OR REPLACE FUNCTION public.clip_ensure_tenant_for_user(p_user uuid, p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM public.clip_members WHERE id = p_user;
  IF t IS NOT NULL THEN RETURN t; END IF;
  INSERT INTO public.clip_tenants (name) VALUES (coalesce(nullif(split_part(p_email, '@', 1), ''), 'My workspace'))
    RETURNING id INTO t;
  INSERT INTO public.clip_members (id, tenant_id, email, role) VALUES (p_user, t, coalesce(p_email, ''), 'owner')
    ON CONFLICT (id) DO NOTHING;
  RETURN (SELECT tenant_id FROM public.clip_members WHERE id = p_user);
END $$;
REVOKE ALL ON FUNCTION public.clip_ensure_tenant_for_user(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clip_tenant_usage_minutes(p_tenant uuid, p_since timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(quantity), 0) FROM public.clip_usage_events
  WHERE tenant_id = p_tenant AND kind = 'ingest' AND created_at >= p_since;
$$;
REVOKE ALL ON FUNCTION public.clip_tenant_usage_minutes(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- Runs inside RLS; SECURITY DEFINER stops it recursing through clip_members' own policy.
CREATE OR REPLACE FUNCTION public.clip_current_tenant()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.clip_members WHERE id = auth.uid();
$$;

-- --- Row level security -------------------------------------------------------
-- Clients only READ (for Realtime and direct queries). Every write goes through
-- the Worker with the service role, which bypasses RLS.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clip_tenants','clip_members','clip_projects','clip_artifacts','clip_transcripts','clip_candidates',
                           'clip_clips','clip_render_jobs','clip_feedback','clip_subscriptions','clip_usage_events','clip_brandkits']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant read" ON public.%I', t);
  END LOOP;
END $$;

CREATE POLICY "tenant read" ON public.clip_tenants FOR SELECT TO authenticated USING (id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_members FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_projects FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_clips FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_subscriptions FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_usage_events FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_brandkits FOR SELECT TO authenticated USING (tenant_id = public.clip_current_tenant());
CREATE POLICY "tenant read" ON public.clip_artifacts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clip_projects p WHERE p.id = project_id AND p.tenant_id = public.clip_current_tenant()));
CREATE POLICY "tenant read" ON public.clip_transcripts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clip_projects p WHERE p.id = project_id AND p.tenant_id = public.clip_current_tenant()));
CREATE POLICY "tenant read" ON public.clip_candidates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clip_projects p WHERE p.id = project_id AND p.tenant_id = public.clip_current_tenant()));
CREATE POLICY "tenant read" ON public.clip_render_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clip_clips c WHERE c.id = clip_id AND c.tenant_id = public.clip_current_tenant()));
CREATE POLICY "tenant read" ON public.clip_feedback FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clip_clips c WHERE c.id = clip_id AND c.tenant_id = public.clip_current_tenant()));

-- --- Realtime (§13.1) ----------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.clip_projects;    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.clip_candidates;  EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.clip_render_jobs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

SELECT 'INSTALLED: Clipper tables (clip_*) are in place' AS result;
