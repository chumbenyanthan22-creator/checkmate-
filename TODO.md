# SovereignHalt dashboard outcomes

- [x] **Brand and runtime header.** App name is SovereignHalt. Show a top header bar with a glowing chip icon and “SOVEREIGNHALT” in bold neon text. Show LIVE • ACTIVE only when a real scoped source read succeeds; otherwise show the true connecting, unconfigured, empty, test-workspace, or error state. Include a session timer and SEC LEVEL badge without inventing telemetry.
- [x] **Left-side live panels.** Include Agent Status, Real-time Metrics, and an Agent Activity chart. Display only real names and statuses supported by workspace records. “Do NOT show any demo agents.” Counts and chart values must be derived from scoped records and timestamps; show honest empty/unavailable states when data is absent.
- [x] **Center agent graph.** Include a large holographic 3D force-directed network of real agents with glowing nodes and animated connections. Never add synthetic/demo nodes or label ambient particles as agents. Graph links are visualization layout unless a real relationship source exists.
- [x] **Right-side analytics and log.** Include Analytics & Prediction and System Log. Analytics are derived only from real scoped rows. Do not present a guessed forecast; state that prediction is unavailable unless a real prediction source is connected. System Log contains only real scoped events.
- [x] **Operator control bar.** Provide `[ PAUSE ] [ EXPORT LOG ] [ ISOLATE AGENT ] [ RECALIBRATE ]`. Keep all four controls responsive. Pause affects the visualization, export includes only loaded real records, isolate affects only the selected visualization node, and recalibrate resets the visualization; do not imply an unintegrated runtime command was sent.
- [x] **Holographic cyberpunk visual system.** Use the requested high-end holographic cyberpunk treatment: deep black background, strong neon purple + cyan glow, holographic 3D elements, floating particles, glass panels, cinematic lighting, dense information, premium sci-fi look. Rebuild the center graph so it feels alive and powerful.
- [x] **Strict data integrity.** “Only show real agents.” “No ‘Demo Mode’ badge.” Never use fabricated names, fixture values, seeded test-workspace rows, guessed statuses, fake metrics, or stale values after query failure. Real source-backed statuses may include Healthy and Loop Detected; show Loop Detected only when supported by source status/event evidence. Keep displayed numbers realistic and clean.

## Existing cost-tracking outcomes

- [ ] Add estimate-based `CostCalculator` with config-loaded model pricing.
- [ ] Persist estimated output tokens, model name, and calculated cost for every tool execution.
- [ ] Increment `agent_sessions.current_spend_usd` from logged tool costs.
- [ ] Add cached daily spend aggregation and dashboard cost trend/per-call cost display.
