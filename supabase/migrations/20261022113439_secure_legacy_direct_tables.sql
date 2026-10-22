-- Review and apply manually after 20261022113438_remove_legacy_acme_demo.sql.
-- The browser no longer queries these unscoped legacy tables. Keep access
-- limited to trusted server-side credentials; do not add public read policies.

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.agent_sessions,
  public.tool_execution_logs,
  public.agent_alerts
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.tool_execution_logs_id_seq,
  public.agent_alerts_id_seq
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.agent_sessions,
  public.tool_execution_logs,
  public.agent_alerts
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE
  public.tool_execution_logs_id_seq,
  public.agent_alerts_id_seq
TO service_role;
