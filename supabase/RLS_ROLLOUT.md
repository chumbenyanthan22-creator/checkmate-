# SovereignHalt Supabase authentication and RLS rollout

This document is a **production migration plan**, not an automatically applied migration. The existing telemetry tables have RLS disabled so the public dashboard's explicitly workspace-scoped reads can resolve. Migration history contains a seeded test workspace; the dashboard blocks that workspace and never presents its rows as live agent telemetry. Do not enable RLS until the dashboard has authenticated access and server-side write paths.

## Required schema changes

1. Add `workspace_id` or `company_id` to `agent_sessions`, `tool_execution_logs`, and `agent_alerts`.
2. Backfill existing rows to their correct tenant workspace.
3. Add non-null constraints only after backfill succeeds.
4. Add indexes on each tenant key and session foreign key.

## Access model

- Dashboard reads use Supabase Auth JWTs.
- The Python SDK writes through a server-side ingestion endpoint or a tightly scoped customer API key.
- Never expose a service-role key in frontend code.
- Every query is scoped to the authenticated workspace.

## Policy shape

Policies should ensure:

```sql
workspace_id = (auth.jwt() ->> 'workspace_id')::uuid
```

Use separate policies for `SELECT`, `INSERT`, and `UPDATE`. Do not grant unrestricted `anon` access to detector tables.

## Rollout checklist

- [ ] Add tenant columns and backfill existing rows.
- [ ] Add authenticated dashboard session handling.
- [ ] Add server-side ingestion endpoint.
- [ ] Add policy tests for cross-tenant reads and writes.
- [ ] Verify Slack actions are bound to a tenant-scoped session.
- [ ] Enable RLS in staging.
- [ ] Run the full dashboard and SDK integration suite.
- [ ] Enable RLS in production only after the above checks pass.

## Why this is not auto-applied

Enabling RLS without policies can make existing dashboard queries return no rows. Applying it to the live project without a confirmed tenant/auth design would be an unsafe access change.
