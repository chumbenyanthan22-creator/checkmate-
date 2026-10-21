# AgentBreaker control-plane implementation plan

## Product direction
AgentBreaker is the AI agent runtime control plane: a live operations surface where teams can inspect the agent fleet, see runtime enforcement in motion, and respond to high-risk actions. Keep the existing registry, policy, approval, audit, settings, cost telemetry, and seeded/Supabase-backed data behavior intact while making the runtime visualization the dashboard's focal point.

## Design direction
- **Design movement:** cyberpunk incident-response cockpit, presented as a precise operator console rather than a game HUD.
- **Core principles:** live state before decoration; every glow signals a system state; glass surfaces layer the control plane; critical actions stay obvious and auditable.
- **Color philosophy:** deep black establishes the night-shift control room; neon cyan denotes active telemetry and protected execution; electric purple marks agent activity and orchestration; saturated red is reserved for blocks and emergency conditions.
- **Layout paradigm:** persistent compact left rail, sticky command header, asymmetric center stage with the 3D runtime field beside a narrow signal/readout rail, then operational metrics, activity, policy, and approval surfaces.
- **Signature elements:** a real animated orbital agent core built with React Three Fiber + drei + Three.js; translucent holographic glass panels with cyan/purple edge light; thin grid/radar lines and state-specific red alert pulses.
- **Interaction philosophy:** selecting a live 3D agent updates the focused-node readout; its Open profile action reaches the same agent profile used by the registry; orbit controls allow direct inspection; the scene can be paused/resumed; existing filters, policy switches, approval decisions, time-range control, navigation, and emergency stop remain functional.
- **Animation:** continuously rotating orbital geometry, moving agent nodes and low-density star/debris field; restrained glass shimmer; red pulses only for blocked/emergency state; honor reduced-motion preference where possible.
- **Typography system:** keep the readable existing sans-serif foundation and use compact uppercase, monospaced-feeling telemetry labels; preserve strong contrast and tabular metric emphasis.
- **Brand essence:** the vigilant runtime boundary that lets teams deploy autonomous agents without surrendering operator control. Personality: precise, vigilant, composed.
- **Brand voice:** direct and operational. Example lines: “Bounded autonomy. Visible by default.” and “Stop risky actions before they leave the control boundary.”
- **Wordmark/mark:** retain the shield and interrupt slash as a compact runtime-safety mark.
- **Signature brand color:** AgentBreaker neon cyan `#5CEBFF`, paired with electric purple and alert red.

## Implementation
- Use the repository's existing React/Vite application and keep its existing state/data integrations; do not add a server, database, or external image dependency for this visual change.
- Make the existing `Home.tsx` dashboard the routed control plane, repairing the current entry import that points at a missing `ControlPlane.tsx`.
- Add a reusable `AgentCoreScene.tsx` component using the installed `@react-three/fiber`, `@react-three/drei`, and `three` packages. The Canvas must render animated 3D geometry, emissive materials, orbital agent nodes, stars, and interactive selection; it must not be a static image or CSS-only substitute.
- Add a focused cyberpunk stylesheet for glass surfaces, neon state tokens, the 3D stage, and responsive layout while preserving the existing product interaction surfaces.
- Keep the single `/` route and current route manifest. Keep user-facing dashboard data behavior compatible with the current demo/Supabase loading logic.

## Project structure
- `client/src/App.tsx`: application route and providers.
- `client/src/pages/Home.tsx`: existing control-plane shell, data state, and interactive dashboard views.
- `client/src/components/AgentCoreScene.tsx`: animated Three.js scene and interactive agent nodes.
- `client/src/cyberpunk.css`: AgentBreaker cyberpunk/glass theme and responsive additions.
- `client/src/index.css`: existing shared styles and theme tokens.
- `client/public/manus-routes.json`: root-route manifest.
- `app.config.ts`: existing project logo metadata.
- `TODO.md`: outcome-focused dashboard acceptance clauses and any still-open cost tracking work.
