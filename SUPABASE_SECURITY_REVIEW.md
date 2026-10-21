# Supabase connection and GitHub check

## Connection configuration

The browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The supplied values are stored in the ignored local `.env.local` file and are not committed. The same variable names have been added to the repository's existing `Production` GitHub Actions environment; their values are intentionally not repeated here.

A read-only REST probe using `select=*` with `limit=0` returned HTTP 200 for each of the six statically referenced client tables: `agent_alerts`, `agents`, `approvals`, `audit_events`, `policies`, and `tool_execution_logs`. The probe requested no rows and did not test writes or authenticated-user-specific RLS behavior.

The current repository workflow is only `.github/workflows/tests.yml`; it does not declare the `Production` environment or reference the Vite variables. Thus, the GitHub environment variables are stored as requested, but this workflow does not inject them into a deployment build. The actual hosting/build pipeline must also use these names if it builds outside this local preview.

## Red GitHub check

The failed check is **Supabase Preview**, not the frontend TypeScript or test suite. GitHub reports: `Remote migration versions not found in local migrations directory.` The same failure is present on commit `870bf54` and its parent `ba57406`, so it predates the current neural-core redesign. The publishable browser key can reach the REST schema but cannot reconcile database migration history. No database migration repair, reset, or other remote schema change was attempted.

To clear this check, the remote Supabase migration history must be reconciled with the checked-in migration files using project-owner database access. Review the remote/local migration list before any repair; do not reset the database as a shortcut.
