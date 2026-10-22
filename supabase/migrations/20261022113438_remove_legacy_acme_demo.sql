-- Review and apply manually in the existing Supabase project.
-- This removes only the exact legacy fixture workspace seeded by
-- 20261003_agentbreaker_funding_ready_schema.sql. It is not run by the app build.

DROP POLICY IF EXISTS "demo workspace readable" ON public.workspaces;
DROP POLICY IF EXISTS "demo agents readable" ON public.agents;
DROP POLICY IF EXISTS "demo policies readable" ON public.policies;
DROP POLICY IF EXISTS "demo approvals readable" ON public.approvals;
DROP POLICY IF EXISTS "demo audit readable" ON public.audit_events;

DO $$
DECLARE
  fixture_workspace_id CONSTANT uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = fixture_workspace_id
      AND slug = 'acme-prod-7f29'
      AND name = 'Acme Systems'
      AND plan = 'demo'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM public.agents
      WHERE workspace_id = fixture_workspace_id
        AND (
          id NOT IN (
            '21111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222',
            '23333333-3333-3333-3333-333333333333'
          )
          OR (id = '21111111-1111-1111-1111-111111111111' AND (slug <> 'invoice' OR name <> 'Invoice Agent'))
          OR (id = '22222222-2222-2222-2222-222222222222' AND (slug <> 'support' OR name <> 'Support Resolution Agent'))
          OR (id = '23333333-3333-3333-3333-333333333333' AND (slug <> 'vendor' OR name <> 'Vendor Verification Agent'))
        )
    ) OR EXISTS (
      SELECT 1 FROM public.policies WHERE workspace_id = fixture_workspace_id
        AND id NOT IN (
          '31111111-1111-1111-1111-111111111111',
          '32222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333',
          '34444444-4444-4444-4444-444444444444',
          '35555555-5555-5555-5555-555555555555'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.approvals WHERE workspace_id = fixture_workspace_id
        AND id NOT IN (
          '41111111-1111-1111-1111-111111111111',
          '42222222-2222-2222-2222-222222222222',
          '43333333-3333-3333-3333-333333333333'
        )
    ) OR EXISTS (
      SELECT 1 FROM public.audit_events WHERE workspace_id = fixture_workspace_id
        AND id NOT IN (
          '51111111-1111-1111-1111-111111111111',
          '52222222-2222-2222-2222-222222222222',
          '53333333-3333-3333-3333-333333333333',
          '54444444-4444-4444-4444-444444444444',
          '55555555-5555-5555-5555-555555555555',
          '56666666-6666-6666-6666-666666666666',
          '57777777-7777-7777-7777-777777777777'
        )
    ) THEN
      RAISE NOTICE 'Acme fixture workspace contains noncanonical rows; public demo policies were dropped, but fixture data was retained for manual review.';
    ELSE
      -- The legacy cost migration adds an agent FK without ON DELETE CASCADE.
      -- Remove only tool logs for fixture agent IDs still scoped to this workspace.
      IF to_regclass('public.tool_execution_logs') IS NOT NULL AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tool_execution_logs'
          AND column_name = 'agent_id'
      ) THEN
        DELETE FROM public.tool_execution_logs
        WHERE agent_id IN (
          SELECT id
          FROM public.agents
          WHERE workspace_id = fixture_workspace_id
            AND id IN (
              '21111111-1111-1111-1111-111111111111',
              '22222222-2222-2222-2222-222222222222',
              '23333333-3333-3333-3333-333333333333'
            )
        );
      END IF;

      DELETE FROM public.audit_events WHERE workspace_id = fixture_workspace_id;
      DELETE FROM public.approvals WHERE workspace_id = fixture_workspace_id;
      DELETE FROM public.policies WHERE workspace_id = fixture_workspace_id;
      DELETE FROM public.agents WHERE workspace_id = fixture_workspace_id;
      DELETE FROM public.workspaces
      WHERE id = fixture_workspace_id
        AND slug = 'acme-prod-7f29'
        AND name = 'Acme Systems'
        AND plan = 'demo';
    END IF;
  END IF;
END
$$;
