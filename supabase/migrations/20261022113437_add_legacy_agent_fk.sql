-- Apply after 20261003_agentbreaker_funding_ready_schema.sql creates public.agents.
-- This is safe whether migration 002 previously created the FK or not.

ALTER TABLE public.tool_execution_logs
  ADD COLUMN IF NOT EXISTS agent_id uuid;

DO $$
BEGIN
  IF to_regclass('public.agents') IS NULL THEN
    RAISE EXCEPTION 'public.agents must exist before adding the tool_execution_logs.agent_id foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tool_execution_logs_agent_id_fkey'
      AND conrelid = 'public.tool_execution_logs'::regclass
  ) THEN
    ALTER TABLE public.tool_execution_logs
      ADD CONSTRAINT tool_execution_logs_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES public.agents(id);
  END IF;
END
$$;
