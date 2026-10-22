# SovereignHalt runtime dashboard plan

## Product scope
Rebuild the existing root dashboard as SovereignHalt, a dense real-agent runtime console. The single `/` route opens the dashboard. Remove unused demo/showcase surfaces from the shipped app. Only actual records produced by the repository's Python SDK may appear; never substitute seeded test-workspace records, synthetic agent nodes, stale values, or guessed telemetry.

## Design
- **Design movement:** high-density holographic cyberpunk operations cockpit.
- **Core principles:** real records only; the 3D network is the visual focal point; compact telemetry stays legible; authenticated source state and local visualization controls are distinct from runtime enforcement.
- **Color philosophy:** deep black keeps the scene cinematic; neon cyan signals observed activity, ultraviolet signals system structure, and red is reserved for source-recorded loop/block signals.
- **Layout paradigm:** compact top console header; a three-column field with agent status, real-time metrics, and activity chart at left; force-directed WebGL agent graph in the center; sourced analytics and system log at right; operator strip below.
- **Signature elements:** luminous microchip wordmark, translucent telemetry panels, and a cinematic field of detailed robotic agent avatars with gyroscopic halos and animated data-light around actual records.
- **Interaction philosophy:** selecting an agent focuses its real node; pause/resume, isolate and recalibrate act only on the local visualization; export contains only authenticated, workspace-scoped records.
- **Animation:** smooth force-directed motion, animated hologram scan/glow, rotating agent-specific gyroscopic rings, atmospheric particles, and flowing edge pulses; respect reduced-motion preferences; pause stops visualization motion without claiming to pause a runtime.
- **Typography system:** Space Grotesk for interface copy, IBM Plex Mono for compact telemetry labels, tabular numerals for measured values.
- **Brand essence:** an inspectable boundary around autonomous runtime behavior; precise, vigilant, composed.
- **Brand voice:** concise and operational. Examples: “Only verified workspace records.” and “No prediction is shown without a connected model.”
- **Wordmark/mark:** cyan-violet holographic microchip glyph paired with the bold SOVEREIGNHALT wordmark.
- **Signature brand color:** electric cyan `#56E6FF`, paired with ultraviolet `#A679FF`.

## Implementation
- **Private dashboard authentication:** use Supabase email OTP, persist the session in the browser, and require an explicit server-side `SOVEREIGNHALT_ALLOWED_EMAILS` allowlist. Do not fetch or render workspace data before the authenticated user passes that allowlist. If auth configuration is missing or access is denied, fail closed with a clear sign-in/denied state.
- **Private read API:** implement `GET /api/telemetry/dashboard`. Verify a confirmed Supabase email on the server, enforce the email allowlist, and query only the fixed SovereignHalt workspace with its exact slug, name, and private plan marker. Return minimal records, bound timestamps above by server time, and omit database-default counters that ingestion does not maintain. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side; the browser uses only the Supabase publishable key for OTP login and never queries tenant tables directly.
- **SDK ingestion API:** implement `POST /api/telemetry/ingest`, using a server-only registry of real agent profiles and unique per-agent bearer tokens checked in constant time. Derive canonical identity solely from the matched token; accept only `{event:{id, action, signal}}` with a bounded action identifier, an allowlisted explicit signal, and UUID event ID. Derive outcome/status/risk/detail on the server, stamp timestamps server-side, and make event writes idempotent. Never accept caller-chosen identity, status, risk, timestamps, free-form detail, raw tool arguments, or outputs. Insert the fixed private workspace marker only when absent; reject collisions instead of overwriting other workspace rows. Create an unlisted provisional agent before its event, link the UUID before marking it recently seen, and avoid exposing partial writes.
- **Python producer:** extend `SupabaseLogger`, `CheckmateHandler`, and the LangChain callback with opt-in transport to `POST /api/telemetry/ingest`. Require a unique server-registered per-agent token and explicit local agent configuration; local name/slug/UUID labels are not sent as identity claims. Emit only a bounded action identifier, explicit allowlisted signal, and event UUID—never tool arguments, outputs, or free-form reasons. Reject missing/invalid signals rather than guessing from text. Require a validated HTTPS ingestion URL; API-only runtimes need only their per-agent token, not a Supabase service-role key. Retain legacy direct session/cost logging, but require the protected API for dashboard decisions.
- **Dashboard data:** replace direct browser table queries with the authenticated read API. Return only registered agents with a recent validated SDK event linked by a non-null UUID; derive each visible agent's health and visualization risk from its latest validated event, not database defaults. Continue to suppress the known seeded test workspace. Empty, unconfigured, unauthenticated, unauthorized and API-error states contain no agent records.
- **Data controls:** Pause, Export Log, Isolate Agent and Recalibrate remain local to the visualization; export includes only loaded authenticated records.
- **Environment contract:** document browser `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`; server `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SOVEREIGNHALT_ALLOWED_EMAILS`, and the secret per-agent `SOVEREIGNHALT_INGEST_AGENTS_JSON` registry; SDK `SOVEREIGNHALT_INGEST_URL`, its own `SOVEREIGNHALT_INGEST_TOKEN`, and the registered real name/slug. Keep the workspace identity fixed in server code. Never commit or expose secret values. The Vercel connector was not approved, so production environment configuration remains an explicit deployment prerequisite.
- **Design and responsive behavior:** keep the selected real agent as the cinematic core with a pulsing chest light, luminous faceplate, transparent holographic shell, gyroscopic rings, and scan/light effects. Surrounding avatars map one-to-one to actual agents. Bound the Canvas independently of viewport height and prevent portrait desktop-site overflow.
- **Metadata:** keep the browser title, frontend package, README, public SDK distribution/import namespace, Slack alerts, and visible wordmark branded SovereignHalt. Keep `agentbreaker` imports and existing database schema available as compatibility contracts.

## Project structure
- `client/src/pages/SovereignHaltDashboard.tsx`: auth gate, dashboard panels, metrics and visualization controls.
- `client/src/lib/supabase.ts`: browser auth client (publishable key only).
- `client/src/components/NeuralCoreScene.tsx`: authenticated agent records rendered as the force-directed 3D field.
- `client/src/sovereignhalt.css`: responsive holographic dashboard and sign-in design.
- `api/telemetry/dashboard.ts` and `api/telemetry/ingest.ts`: thin root-level Vercel Node function entrypoints; keep only deployable wrappers in `/api`.
- `server/api/telemetry/common.ts`, `dashboard.ts`, and `ingest.ts`: shared auth, immutable workspace marker, bounded raw-body parser, scoped reads, and token-protected ingestion handlers.
- `server/_core/index.ts`: mount the same telemetry handlers in local Express before its general JSON parsers; `tests/api/telemetry/`: shared-handler regression tests outside the deployable function tree.
- `agentbreaker/session_ids.py`: preserve UUID inputs and map legacy string session/company keys deterministically to schema-compatible UUIDs for direct session/cost compatibility.
- `agentbreaker/callback.py` and `agentbreaker/supabase_logger.py`: explicit opt-in public callback telemetry and the protected API transport.
- `sovereignhalt/`: canonical Python distribution/import facade; `agentbreaker/` and its implementation remain installed as a backward-compatible namespace.
- `.env.example`, `SUPABASE.md`, and `TODO.md`: environment/setup instructions and outcome tracking.
- `client/public/manus-routes.json`, `client/index.html`, and `app.config.ts`: route, title and logo metadata.
