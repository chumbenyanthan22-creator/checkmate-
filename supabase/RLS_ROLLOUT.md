# SovereignHalt Supabase access model and RLS rollout

This is a manual production migration guide. None of the three new migrations below was executed during this task.

## Current access model

- The browser signs in with Supabase email OTP and the publishable key; it does not query telemetry tables directly.
- `GET /api/telemetry/dashboard` verifies the Supabase user, confirmed email, and exact server-side allowlist before reading the fixed SovereignHalt workspace with the server-only service-role key.
- `POST /api/telemetry/ingest` accepts a unique per-agent bearer token and structured event only. It does not accept caller-supplied profile/status metadata or raw tool content.
- The Python SDK's default API-only mode needs no Supabase database credential and ignores database credentials even if they are present in the process environment.
- Optional legacy session/cost writes require the explicit `SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE=true` opt-in, a trusted server runtime, and a service-role key. The legacy `SUPABASE_KEY` alias is accepted only for a `role=service_role` JWT claim or `sb_secret_` key prefix; Supabase validates the actual credential on requests.
- Never put a service-role key in browser code, use an anon/publishable key for legacy direct writes, or expose unscoped session/cost tables to `PUBLIC`, `anon`, or `authenticated`.

## Legacy schema and required manual migrations

The historical migrations created the Acme fixture workspace and five public demo-read policies. They also created unscoped `agent_sessions`, `tool_execution_logs`, and `agent_alerts` tables without RLS. The historical `002_cost_tracking.sql` added `tool_execution_logs.agent_id` with a foreign key before `public.agents` existed, which breaks a clean filename-ordered install. The current code keeps that early column nullable without an FK and adds the FK after the agents table exists.

Review and manually apply these migrations in timestamp order:

1. `20261022113437_add_legacy_agent_fk.sql` ensures `tool_execution_logs.agent_id` exists and adds the FK only after `public.agents` exists. It is idempotent when an earlier deployment already created the same named constraint.
2. `20261022113438_remove_legacy_acme_demo.sql` drops the five exact demo-read policies. It deletes the Acme fixture only if its reserved UUID, slug, name, and `demo` plan match and all workspace children have canonical fixture IDs. It removes tool logs only for the three fixture agent IDs still attached to that workspace. If unexpected rows exist, it emits a notice and retains the fixture data for manual review.
3. `20261022113439_secure_legacy_direct_tables.sql` enables RLS and revokes table and sequence privileges from `PUBLIC`, `anon`, and `authenticated` on the unscoped session/cost/alert tables. It creates no public policies and explicitly grants the needed table/sequence privileges to `service_role` for trusted server-side legacy writers.

These migrations are not part of the frontend/server build and are not applied automatically. Until an owner applies them, the old demo policies and legacy table access settings remain in effect in Supabase. Review the target project and fixture markers before applying; do not replay the historical seed migration because it uses fixed IDs and upserts.

## After manual application

- Confirm the five named demo-read policies are absent.
- If the Acme fixture had only canonical rows, confirm its workspace and fixture rows are gone. If the migration emitted a notice, retain and manually inspect those rows rather than broadening the delete.
- Confirm `agent_sessions`, `tool_execution_logs`, and `agent_alerts` have RLS enabled, no `PUBLIC`/`anon`/`authenticated` table or sequence privileges, and the intended `service_role` grants.
- Verify that legacy direct writes work only from a trusted server with the explicit opt-in and service-role key, and that the dashboard uses the authenticated API rather than direct browser queries.
- Configure Supabase Auth allowlisting, Vercel server-only environment values, and at least one genuine registered producer before expecting a live dashboard feed. Until a successful real SDK event arrives, the dashboard should remain empty.

## Future multi-tenant direct access

The legacy session/cost tables have no workspace key, so they cannot safely support browser-level or tenant-scoped access. If that is ever needed, first add and backfill an ownership column and indexes, then design explicit per-operation policies and test cross-tenant denial. Do not add broad `anon` policies or infer ownership from caller-controlled session IDs.
