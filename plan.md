# AgentBreaker control-plane implementation plan

## Product direction
AgentBreaker is the AI agent runtime control plane: a live operations surface where teams can inspect the agent fleet, see runtime enforcement in motion, and respond to high-risk actions. Keep the existing registry, policy, approval, audit, settings, cost telemetry, and seeded/Supabase-backed data behavior intact while making the runtime visualization the dashboard's focal point.

## Design direction
- **Design movement:** high-density cyberpunk telemetry cockpit inspired by the supplied neural-trading dashboard image, reinterpreted as an AI runtime security console rather than a trading product or landing page.
- **Core principles:** one operational screen; a real 3D live core anchors the layout; dense telemetry remains readable; every glow encodes a meaningful state.
- **Color philosophy:** deep black keeps the console immersive; cyan signals active execution and trusted routes; electric purple marks orchestration; amber supports neutral analytics; red is reserved for blocked or emergency states.
- **Layout paradigm:** keep the persistent app navigation and consolidate Overview into one viewport-filling dashboard: KPI strip and runtime controls above, compact status/activity rails around a dominant center 3D neural core, and approvals, spend, and action summaries integrated into the same surface. Do not stack a second marketing/landing section beneath the console.
- **Signature elements:** a real animated, lobulated two-hemisphere point-cloud AI core with a moving scan field and agent-linked 3D tethers; layered glass HUD cards; compact waveform and risk-distribution graphics.
- **Interaction philosophy:** selecting an agent updates the core and focused-agent telemetry; Open profile reaches the matching registry record; preserve functional time-range/activity filters, pause/resume, log export, local isolation/recalibration, approval actions, and emergency stop.
- **Animation:** animate point-cloud rotation, breathing, scan bands, and connected nodes; keep motion subtle and the object immediately legible; freeze the scene on pause or emergency stop and honor reduced-motion preference.
- **Typography system:** keep the readable existing sans-serif foundation and use compact uppercase, monospaced-feeling telemetry labels; preserve strong contrast and tabular metric emphasis.
- **Brand essence:** the vigilant runtime boundary that lets teams deploy autonomous agents without surrendering operator control. Personality: precise, vigilant, composed.
- **Brand voice:** direct and operational. Example lines: “Bounded autonomy. Visible by default.” and “Stop risky actions before they leave the control boundary.”
- **Wordmark/mark:** retain the shield and interrupt slash as a compact runtime-safety mark.
- **Signature brand color:** AgentBreaker neon cyan `#5CEBFF`, paired with electric purple and alert red.

## Implementation
- Use the repository's existing React/Vite application and keep its existing state/data integrations; do not add a server, database, or external image dependency for this visual change.
- Make the existing `Home.tsx` dashboard the routed control plane, repairing the current entry import that points at a missing `ControlPlane.tsx`.
- Rework `AgentCoreScene.tsx` into one viewport-filling operator console and replace `HolographicChessboard.tsx` with a dedicated `NeuralCoreScene.tsx` using the installed `@react-three/fiber`, `@react-three/drei`, and `three` packages. The Canvas must render a moving procedural 3D point-cloud/mesh core, filaments, scan geometry, and agent-linked nodes; it must not be a static image or CSS-only substitute.
- Add focused cyberpunk styling for a dense single-screen cockpit, glass telemetry rails, the 3D neural stage, inline activity and approval surfaces, operator controls, and responsive layout.
- Keep the single `/` route and current route manifest. Keep user-facing dashboard data behavior compatible with the current demo/Supabase loading logic.

## Project structure
- `client/src/App.tsx`: application route and providers.
- `client/src/pages/Home.tsx`: existing control-plane shell, data state, and interactive dashboard views.
- `client/src/components/AgentCoreScene.tsx`: compact single-screen runtime cockpit, summary telemetry, and operator actions.
- `client/src/components/NeuralCoreScene.tsx`: procedural React Three Fiber point-cloud core, scan geometry, and live agent-linked 3D nodes.
- `client/src/cyberpunk.css`: AgentBreaker cyberpunk/glass theme and responsive additions.
- `client/src/index.css`: existing shared styles and theme tokens.
- `client/public/manus-routes.json`: root-route manifest.
- `app.config.ts`: existing project logo metadata.
- `TODO.md`: outcome-focused dashboard acceptance clauses and any still-open cost tracking work.
