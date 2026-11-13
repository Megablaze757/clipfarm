-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TENANTS & PROFILES
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  stripe_customer_id text UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role text NOT NULL DEFAULT 'owner', -- 'owner' | 'editor' | 'viewer'
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. PROJECTS
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  source_kind text NOT NULL, -- 'upload' | 'url' | 's3'
  source_uri text NOT NULL,
  status text NOT NULL DEFAULT 'queued', -- queued|transcoding|transcribing|analyzing|candidates|scoring|ready|failed
  duration_ms int,
  language text,
  error_code text,
  error_detail text,
  loudness_json jsonb,
  model_versions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_projects_tenant_created ON public.projects (tenant_id, created_at DESC);

-- 3. ARTIFACTS
CREATE TABLE public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage text NOT NULL,
  uri text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  model_versions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage)
);

-- 4. TRANSCRIPTS
CREATE TABLE public.transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  words jsonb NOT NULL, -- [{w, t0, t1, conf, speaker}]
  segments jsonb NOT NULL,
  speakers jsonb NOT NULL DEFAULT '[]',
  edited_by uuid REFERENCES auth.users(id),
  edited_at timestamptz
);

-- 5. CANDIDATES
CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
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
CREATE INDEX idx_candidates_project_score ON public.candidates (project_id, score DESC);

-- 6. CLIPS
CREATE TABLE public.clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text,
  t_in_ms int NOT NULL,
  t_out_ms int NOT NULL,
  edits jsonb NOT NULL DEFAULT '{}', -- {captions, layout, template_id}
  status text NOT NULL DEFAULT 'draft', -- draft|approved|exported
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. RENDER JOBS
CREATE TABLE public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  preset text NOT NULL,
  kind text NOT NULL, -- 'proxy' | 'final'
  status text NOT NULL DEFAULT 'queued',
  uri text,
  error_code text,
  duration_ms int,
  container_ms int,
  queued_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- 8. FEEDBACK
CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  signal text NOT NULL, -- 'not_good'|'exported'|'published'|'edited_heavy'
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'inactive',
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. USAGE EVENTS
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  kind text NOT NULL, -- 'ingest' | 'render'
  quantity numeric NOT NULL,
  stripe_meter_event_id text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 11. BRANDKITS
CREATE TABLE public.brandkits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  fonts jsonb,
  colors jsonb,
  caption_style jsonb,
  logo_uri text,
  intro_uri text,
  outro_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ROW LEVEL SECURITY (RLS) SETUP
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brandkits ENABLE ROW LEVEL SECURITY;

-- Helper function to fetch current tenant_id
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

-- RLS POLICIES FOR TENANT ISOLATION
CREATE POLICY "Tenant members view own tenant" ON public.tenants
  FOR SELECT TO authenticated USING (id = public.current_tenant_id());

CREATE POLICY "Profiles viewable by same tenant" ON public.profiles
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

CREATE POLICY "Users manage projects in tenant" ON public.projects
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Users view artifacts via project tenant" ON public.artifacts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND tenant_id = public.current_tenant_id()));

CREATE POLICY "Users view transcripts via project tenant" ON public.transcripts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND tenant_id = public.current_tenant_id()));

CREATE POLICY "Users view candidates via project tenant" ON public.candidates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND tenant_id = public.current_tenant_id()));

CREATE POLICY "Users manage clips in tenant" ON public.clips
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Users view subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
