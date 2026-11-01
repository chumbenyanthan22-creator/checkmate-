-- SovereignHalt multi-tenant MVP schema — MANUAL REVIEW ONLY.
-- This file is intentionally in supabase/pending/, not supabase/migrations/.
-- Do not apply without explicit owner approval. It does not alter legacy tables.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sh_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan_code text NOT NULL DEFAULT 'trial' CHECK (plan_code IN ('trial','starter','pro','enterprise')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sh_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sh_tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','staging','development')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS public.sh_tenant_members (
  tenant_id uuid NOT NULL REFERENCES public.sh_tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.sh_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.sh_tenants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  agent_class text NOT NULL DEFAULT 'standard' CHECK (agent_class IN ('standard','privileged')),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HALTED','DISABLED')),
  halt_reason text CHECK (halt_reason IN ('LOOP_DETECTED','OPERATOR_HALT','OPERATOR_CUT','ADMIN_DISABLED')),
  halted_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES public.sh_workspaces(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.sh_agent_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  key_prefix text NOT NULL CHECK (length(key_prefix) BETWEEN 8 AND 20),
  key_hash char(64) NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL DEFAULT ARRAY['telemetry:write','agent:status:read']::text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (scopes <@ ARRAY['telemetry:write','agent:status:read']::text[]),
  FOREIGN KEY (agent_id, tenant_id) REFERENCES public.sh_agents(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.sh_events_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('tool_call','model_step','guard_signal')),
  action text NOT NULL CHECK (action ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,95}$'),
  signal text NOT NULL CHECK (signal IN ('guard_allowed','policy_blocked','approval_required','budget_exceeded','max_iterations_exceeded','loop_detected','operator_halt','operator_cut','operator_resume')),
  tool_signature char(64) CHECK (tool_signature IS NULL OR tool_signature ~ '^[0-9a-f]{64}$'),
  token_fingerprint char(64) CHECK (token_fingerprint IS NULL OR token_fingerprint ~ '^[0-9a-f]{64}$'),
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_payload) = 'object' AND octet_length(event_payload::text) <= 8192),
  loop_flag boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_id, event_id),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES public.sh_workspaces(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id, tenant_id) REFERENCES public.sh_agents(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sh_members_user_idx ON public.sh_tenant_members(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS sh_agents_workspace_idx ON public.sh_agents(tenant_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sh_events_agent_recent_idx ON public.sh_events_log(tenant_id, agent_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sh_api_keys_agent_idx ON public.sh_agent_api_keys(tenant_id, agent_id) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.sh_is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sh_tenant_members m
    WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.sh_is_tenant_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sh_is_tenant_member(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sh_create_tenant(
  p_owner_user_id uuid, p_name text, p_tenant_slug text, p_workspace_name text, p_workspace_slug text
) RETURNS TABLE(tenant_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_tenant uuid; v_workspace uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sh_tenants(name, slug) VALUES (p_name, p_tenant_slug) RETURNING id INTO v_tenant;
  INSERT INTO public.sh_workspaces(tenant_id, name, slug) VALUES (v_tenant, p_workspace_name, p_workspace_slug) RETURNING id INTO v_workspace;
  INSERT INTO public.sh_tenant_members(tenant_id, user_id, role) VALUES (v_tenant, p_owner_user_id, 'owner');
  RETURN QUERY SELECT v_tenant, v_workspace;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_add_tenant_member(
  p_tenant_id uuid, p_actor_id uuid, p_user_id uuid, p_role text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.sh_tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_actor_id;
  IF COALESCE(v_role, '') NOT IN ('owner','admin') OR COALESCE(p_role, '') NOT IN ('admin','operator','viewer') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sh_tenant_members(tenant_id, user_id, role) VALUES (p_tenant_id, p_user_id, p_role)
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_create_agent_with_key(
  p_tenant_id uuid, p_workspace_id uuid, p_actor_id uuid, p_name text, p_slug text,
  p_agent_class text, p_risk_level text, p_key_prefix text, p_key_hash text
) RETURNS TABLE(agent_id uuid, api_key_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_agent uuid; v_key uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.sh_tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_actor_id;
  IF COALESCE(v_role, '') NOT IN ('owner','admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.sh_agents(tenant_id, workspace_id, name, slug, agent_class, risk_level)
  VALUES (p_tenant_id, p_workspace_id, p_name, p_slug, p_agent_class, p_risk_level) RETURNING id INTO v_agent;
  INSERT INTO public.sh_agent_api_keys(tenant_id, agent_id, key_prefix, key_hash, created_by)
  VALUES (p_tenant_id, v_agent, p_key_prefix, p_key_hash, p_actor_id) RETURNING id INTO v_key;
  RETURN QUERY SELECT v_agent, v_key;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_rotate_agent_key(
  p_tenant_id uuid, p_agent_id uuid, p_actor_id uuid, p_key_prefix text, p_key_hash text
) RETURNS TABLE(api_key_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_key uuid; v_agent uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.sh_tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_actor_id;
  IF COALESCE(v_role, '') NOT IN ('owner','admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_agent FROM public.sh_agents WHERE id = p_agent_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.sh_agent_api_keys SET revoked_at = COALESCE(revoked_at, now())
    WHERE tenant_id = p_tenant_id AND agent_id = p_agent_id AND revoked_at IS NULL;
  INSERT INTO public.sh_agent_api_keys(tenant_id, agent_id, key_prefix, key_hash, created_by)
    VALUES (p_tenant_id, p_agent_id, p_key_prefix, p_key_hash, p_actor_id) RETURNING id INTO v_key;
  RETURN QUERY SELECT v_key;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_ingest_agent_event(
  p_tenant_id uuid, p_workspace_id uuid, p_agent_id uuid, p_event_id uuid,
  p_event_type text, p_action text, p_signal text, p_tool_signature text,
  p_token_fingerprint text, p_event_payload jsonb
) RETURNS TABLE(event_id uuid, loop_detected boolean, status text, halted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE
  v_agent public.sh_agents%ROWTYPE;
  v_event_row_id bigint;
  v_existing_loop boolean;
  v_count integer;
  v_sig_count integer;
  v_sig_min text;
  v_sig_max text;
  v_fp_count integer;
  v_fp_min text;
  v_fp_max text;
  v_loop boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_agent FROM public.sh_agents
    WHERE id = p_agent_id AND tenant_id = p_tenant_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_not_found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.sh_events_log(event_id, tenant_id, workspace_id, agent_id, event_type, action, signal, tool_signature, token_fingerprint, event_payload)
  VALUES (p_event_id, p_tenant_id, p_workspace_id, p_agent_id, p_event_type, p_action, p_signal, p_tool_signature, p_token_fingerprint, COALESCE(p_event_payload, '{}'::jsonb))
  ON CONFLICT (tenant_id, agent_id, event_id) DO NOTHING RETURNING id INTO v_event_row_id;

  IF v_event_row_id IS NULL THEN
    SELECT loop_flag INTO v_existing_loop FROM public.sh_events_log
      WHERE tenant_id = p_tenant_id AND agent_id = p_agent_id AND workspace_id = p_workspace_id AND event_id = p_event_id;
    SELECT * INTO v_agent FROM public.sh_agents WHERE id = p_agent_id AND tenant_id = p_tenant_id;
    RETURN QUERY SELECT p_event_id, COALESCE(v_existing_loop, false), v_agent.status, v_agent.halted_at;
    RETURN;
  END IF;

  IF v_agent.status <> 'ACTIVE' THEN RAISE EXCEPTION 'agent_halted' USING ERRCODE = '55000'; END IF;

  SELECT count(*)::integer, count(tool_signature)::integer, min(tool_signature), max(tool_signature),
         count(token_fingerprint)::integer, min(token_fingerprint), max(token_fingerprint)
    INTO v_count, v_sig_count, v_sig_min, v_sig_max, v_fp_count, v_fp_min, v_fp_max
    FROM (
      SELECT tool_signature, token_fingerprint FROM public.sh_events_log
      WHERE tenant_id = p_tenant_id AND agent_id = p_agent_id AND event_type = 'tool_call'
      ORDER BY created_at DESC, id DESC LIMIT 5
    ) recent;
  v_loop := v_count = 5 AND ((v_sig_count = 5 AND v_sig_min = v_sig_max) OR (v_fp_count = 5 AND v_fp_min = v_fp_max));

  UPDATE public.sh_agents SET last_event_at = now() WHERE id = p_agent_id AND tenant_id = p_tenant_id;
  IF v_loop THEN
    UPDATE public.sh_events_log SET loop_flag = true WHERE id = v_event_row_id;
    UPDATE public.sh_agents SET status = 'HALTED', halt_reason = 'LOOP_DETECTED', halted_at = COALESCE(halted_at, now())
      WHERE id = p_agent_id AND tenant_id = p_tenant_id;
  END IF;
  SELECT * INTO v_agent FROM public.sh_agents WHERE id = p_agent_id AND tenant_id = p_tenant_id;
  RETURN QUERY SELECT p_event_id, v_loop, v_agent.status, v_agent.halted_at;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_set_agent_status(
  p_tenant_id uuid, p_agent_id uuid, p_actor_id uuid, p_command text, p_reason text
) RETURNS TABLE(status text, halted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text; v_status text; v_reason text; v_halted_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.sh_tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_actor_id;
  IF COALESCE(v_role, '') NOT IN ('owner','admin','operator') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF COALESCE(p_command, '') NOT IN ('HALT','CUT','RESUME') THEN RAISE EXCEPTION 'invalid_command' USING ERRCODE = '22023'; END IF;
  v_status := CASE WHEN p_command = 'RESUME' THEN 'ACTIVE' ELSE 'HALTED' END;
  v_reason := CASE p_command WHEN 'HALT' THEN 'OPERATOR_HALT' WHEN 'CUT' THEN 'OPERATOR_CUT' ELSE NULL END;
  UPDATE public.sh_agents SET status = v_status, halt_reason = v_reason,
    halted_at = CASE WHEN v_status = 'ACTIVE' THEN NULL ELSE COALESCE(halted_at, now()) END
    WHERE id = p_agent_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.sh_events_log(event_id, tenant_id, workspace_id, agent_id, event_type, action, signal, event_payload)
    SELECT gen_random_uuid(), a.tenant_id, a.workspace_id, a.id, 'guard_signal', 'operator.status',
      CASE p_command WHEN 'HALT' THEN 'operator_halt' WHEN 'CUT' THEN 'operator_cut' ELSE 'operator_resume' END,
      jsonb_build_object('reason_code', p_reason)
    FROM public.sh_agents a WHERE a.id = p_agent_id AND a.tenant_id = p_tenant_id;
  SELECT a.status, a.halted_at INTO v_status, v_halted_at FROM public.sh_agents a WHERE a.id = p_agent_id AND a.tenant_id = p_tenant_id;
  RETURN QUERY SELECT v_status, v_halted_at;
END; $$;

CREATE OR REPLACE FUNCTION public.sh_revoke_agent_key(
  p_tenant_id uuid, p_agent_id uuid, p_key_id uuid, p_actor_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE v_role text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.sh_tenant_members WHERE tenant_id = p_tenant_id AND user_id = p_actor_id;
  IF COALESCE(v_role, '') NOT IN ('owner','admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sh_agent_api_keys SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = p_key_id AND tenant_id = p_tenant_id AND agent_id = p_agent_id;
  RETURN FOUND;
END; $$;

DO $$ DECLARE fn record; BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('sh_create_tenant','sh_add_tenant_member','sh_create_agent_with_key','sh_rotate_agent_key','sh_ingest_agent_event','sh_set_agent_status','sh_revoke_agent_key')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature); END LOOP;
END $$;

ALTER TABLE public.sh_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sh_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sh_tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sh_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sh_agent_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sh_events_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sh_tenants, public.sh_workspaces, public.sh_tenant_members, public.sh_agents, public.sh_agent_api_keys, public.sh_events_log FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, slug, plan_code, status, created_at) ON public.sh_tenants TO authenticated;
GRANT SELECT ON public.sh_workspaces, public.sh_tenant_members, public.sh_agents, public.sh_events_log TO authenticated;
GRANT ALL ON public.sh_tenants, public.sh_workspaces, public.sh_tenant_members, public.sh_agents, public.sh_agent_api_keys, public.sh_events_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sh_events_log_id_seq TO service_role;

DROP POLICY IF EXISTS sh_tenants_member_read ON public.sh_tenants;
CREATE POLICY sh_tenants_member_read ON public.sh_tenants FOR SELECT TO authenticated USING (public.sh_is_tenant_member(id));
DROP POLICY IF EXISTS sh_workspaces_member_read ON public.sh_workspaces;
CREATE POLICY sh_workspaces_member_read ON public.sh_workspaces FOR SELECT TO authenticated USING (public.sh_is_tenant_member(tenant_id));
DROP POLICY IF EXISTS sh_members_member_read ON public.sh_tenant_members;
CREATE POLICY sh_members_member_read ON public.sh_tenant_members FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.sh_is_tenant_member(tenant_id));
DROP POLICY IF EXISTS sh_agents_member_read ON public.sh_agents;
CREATE POLICY sh_agents_member_read ON public.sh_agents FOR SELECT TO authenticated USING (public.sh_is_tenant_member(tenant_id));
DROP POLICY IF EXISTS sh_events_member_read ON public.sh_events_log;
CREATE POLICY sh_events_member_read ON public.sh_events_log FOR SELECT TO authenticated USING (public.sh_is_tenant_member(tenant_id));
ALTER TABLE public.sh_agent_api_keys NO FORCE ROW LEVEL SECURITY;

COMMIT;
