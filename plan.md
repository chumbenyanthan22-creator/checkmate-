# AgentBreaker client-ready MVP plan

## Product direction
AgentBreaker is an AI-agent runtime control-plane MVP. The interface must never present fixture values as live telemetry: render only records returned for an explicitly scoped Supabase workspace, or an honest loading, disconnected, empty, or error state. The supplied reference is visual inspiration only; its trading identity, names, charts, and metrics are not product data.

## Design direction
- **Design movement:** high-density cyberpunk operations cockpit, with a single screen organized around an organic 3D neural core rather than stacked landing-page sections.
- **Core principles:** true records only; the live Canvas remains the focal point; telemetry is compact and legible; labels distinguish connected data from local UI previews.
- **Color philosophy:** deep black keeps the scene immersive; cyan marks active visualization, purple marks orchestration, and red is reserved for critical or blocked states. Avoid using color to imply enforcement that is not connected.
- **Layout paradigm:** preserve the app shell and left navigation, then keep the runtime console, truthful summary states, data panels, and operator controls in the same viewport. Add a dedicated Plans & Pricing view inside the same app shell.
- **Signature elements:** a procedural, lobulated neural point cloud with visibly moving particles and orbiting agent nodes; translucent telemetry panels; precise monospaced status labels.
- **Interaction philosophy:** navigation, filters, scene focus, pause/resume, log export, plan selection, and existing preview controls must respond. Controls that do not persist to a runtime/database must be labeled as preview-only.
- **Animation:** the point cloud, scan field, and agent nodes animate autonomously by default, including when no agents are connected. Pause/resume remains available. Reduced-motion preference lowers animation speed and amplitude rather than silently freezing the scene.
- **Typography system:** retain the readable sans-serif foundation with compact monospaced telemetry labels; use tabular figures only for genuine data or the explicitly requested prices.
- **Brand essence:** a precise, vigilant runtime boundary that makes AI-agent activity inspectable before it matters. Personality: precise, vigilant, composed.
- **Brand voice:** concise and operational. Example lines: “Bounded autonomy. Visible by default.” and “Connect a workspace to see verified runtime records.”
- **Wordmark/mark:** retain the shield and interrupt slash as the AgentBreaker mark.
- **Signature brand color:** neon cyan `#5CEBFF`, paired with electric purple and alert red.

## Implementation
- Keep the existing React/Vite app and React Three Fiber/drei/Three.js scene. Do not substitute a static image or CSS animation for the Canvas scene.
- Remove all seeded dashboard agents, policies, approvals, events, mock KPIs, fake percentages, sample spend, sample identities, and hard-coded workspace defaults from the UI.
- Require an explicit `VITE_SUPABASE_WORKSPACE_ID` before querying tenant records. Scope every query by that ID; never query unscoped alert or tool-log tables. Until the scope is supplied, show a connected/unconfigured/empty/error state and no pretend numbers.
- Keep app actions truthful: database-backed records are read from Supabase; local-only controls are visibly marked as preview-only; no billing/checkout or runtime enforcement is implied where no integration exists.
- Add a Plans & Pricing view with the user-specified 30-day free trial, Popular `$299/month`, and Enterprise `$1,499/month` tiers. Plan selection is informational/local until billing is integrated.
- Maintain the single `/` route and existing route manifest; add the pricing view as an in-app navigation destination rather than a second landing page.

## Project structure
- `client/src/App.tsx`: application route and providers.
- `client/src/pages/Home.tsx`: app shell, explicit-scope Supabase read flow, truthful empty/error states, existing views, and pricing.
- `client/src/components/AgentCoreScene.tsx`: single-screen runtime cockpit using only verified metrics and records.
- `client/src/components/NeuralCoreScene.tsx`: procedural React Three Fiber neural core, autonomously animated scan geometry, and actual connected agent nodes.
- `client/src/cyberpunk.css`: AgentBreaker cyberpunk/glass theme and responsive layout.
- `client/src/lib/supabase.ts`: optional browser client and workspace scope from environment variables.
- `client/public/manus-routes.json`: root-route manifest.
- `TODO.md`: full acceptance outcomes and existing cost-tracking work.
