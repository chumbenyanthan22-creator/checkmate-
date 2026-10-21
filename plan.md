# SovereignHalt runtime dashboard plan

## Product scope
Rebuild the existing root dashboard from scratch as SovereignHalt, a dense real-agent runtime console. The single `/` route opens the full-screen dashboard. Retain the existing React/Vite application shell only as required by the project; the new console replaces the former sample-driven root experience. Keep the existing Supabase client, but never substitute fixtures, seeded test-workspace records, synthetic agent nodes, stale values, or guessed telemetry for actual scoped workspace records.

## Design
- **Design movement:** high-density holographic cyberpunk operations cockpit.
- **Core principles:** real records only; the 3D network is the visual focal point; compact telemetry stays legible; interface source state and local visualization controls are distinct from runtime enforcement.
- **Color philosophy:** deep black keeps the scene cinematic; neon cyan signals observed activity, ultraviolet signals system structure, and red is reserved for source-recorded loop/block signals.
- **Layout paradigm:** compact top console header; a three-column field with agent status, real-time metrics, and activity chart at left; force-directed WebGL agent graph in the center; sourced analytics and system log at right; operator strip below.
- **Signature elements:** luminous microchip wordmark, translucent telemetry panels, and animated particle field around actual agent nodes.
- **Interaction philosophy:** selecting an agent focuses its real node; pause/resume, isolate and recalibrate act only on the local visualization; export contains only loaded workspace-scoped records.
- **Animation:** smooth force-directed motion and flowing edge pulses; respect reduced-motion preferences; pause stops visualization motion without claiming to pause a runtime.
- **Typography system:** Space Grotesk for interface copy, IBM Plex Mono for compact telemetry labels, tabular numerals for measured values.
- **Brand essence:** an inspectable boundary around autonomous runtime behavior; precise, vigilant, composed.
- **Brand voice:** concise and operational. Examples: “Only verified workspace records.” and “No prediction is shown without a connected model.”
- **Wordmark/mark:** cyan-violet holographic microchip glyph paired with the bold SOVEREIGNHALT wordmark.
- **Signature brand color:** electric cyan `#56E6FF`, paired with ultraviolet `#A679FF`.

## Implementation
- Keep the existing React/Vite and Supabase client. Read `workspaces` metadata first; suppress the seeded test workspace. Query `agents`, `audit_events`, `policies`, and `approvals` only with `.eq('workspace_id', VITE_SUPABASE_WORKSPACE_ID)` and never load tenant rows without an explicitly configured scope.
- Replace demo fallbacks with explicit unconfigured, connecting, live, empty, test-workspace, and error states. Query failure clears data. Show LIVE • ACTIVE only after a successful scoped read; otherwise show the true source state.
- Derive counts, event chart buckets, status badges, and risk summaries only from returned rows and timestamps. Show “Loop Detected” only when a source status or blocked loop-related event supports it. Do not present a guessed forecast; state that prediction is unavailable until a real prediction source exists.
- Build the requested root view in `SovereignHaltDashboard.tsx`, reusing React Three Fiber/drei/Three.js for the force-directed Canvas. Render only actual workspace agent records. Animated links are clearly labeled as visual layout, not observed agent-to-agent traffic.
- Keep Pause, Export Log, Isolate Agent, and Recalibrate functional but local to the preview. Export only loaded records; no live pause/isolation command is sent.
- Update document title, root route title, app icon, and visible wordmark to SovereignHalt; preserve unrelated Python guard, cost-tracking data model, and platform configuration.

## Project structure
- `client/src/pages/Home.tsx`: root route entry to the new dashboard.
- `client/src/pages/SovereignHaltDashboard.tsx`: scoped data loading, source states, dashboard panels, metrics, activity chart, system log, and local controls.
- `client/src/pages/AgentBreakerConsole.tsx`: compatibility re-export to the new root dashboard.
- `client/src/components/NeuralCoreScene.tsx`: animated force-directed Canvas containing only returned workspace agents.
- `client/src/sovereignhalt.css`: responsive holographic dashboard design system.
- `client/src/lib/supabase.ts`: configured Supabase client and explicit workspace scope.
- `client/public/manus-routes.json`, `client/index.html`, `app.config.ts`, `TODO.md`: route, title, logo, and outcome tracking.
