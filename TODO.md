# AgentBreaker control-plane outcomes

- **Deliver the AgentBreaker dashboard with the requested cyberpunk visual language.** Use a deep black background with neon cyan, electric purple, and red glows, plus holographic glass panels; keep the result legible as an AI Agent Runtime Control Plane rather than a static mockup.
- **Deliver a real moving 3D runtime scene at the center of the dashboard.** Implement it with React Three Fiber, drei, and Three.js; render animated 3D geometry and moving agent nodes in a live Canvas, not a static image or CSS-only scene. Allow the operator to inspect/select agents and pause/resume scene motion.
- **Deliver the desktop-first AgentBreaker application shell with dark cyberpunk security-console styling and left navigation for Overview, Agent Registry, Policies, Approvals, Audit Trail, and Settings.** Keep all six destinations visible in the left navigation and allow the user to switch sections without a page reload.
- **Deliver the Overview dashboard with functional seeded/live metrics and monitoring surfaces.** Show KPI cards for Protected Agents, Actions Today, Blocked Actions, and Spend Guarded; include a working time-range control that changes displayed mock metrics; show a live activity feed, status and agent filters, a risk distribution visualization, and a right-side incident/approval panel.
- **Deliver the Agent Registry and clickable agent detail view.** Seed Invoice Agent, Support Resolution Agent, and Vendor Verification Agent with status, class, risk level, budget, and recent activity; selecting an agent must open a governance profile with budget context, recent actions, and operating status. Selecting a node in the 3D scene must update its focused-node readout; the scene's Open profile action must reach the matching profile.
- **Deliver the Policies section with representative runtime guardrails and client-side controls.** Show policy rules for tool access, approval thresholds, spend limits, loop detection, and data handling; toggling a policy must immediately reflect its active or paused state.
- **Deliver approval and response interactions.** Users must be able to approve or block a pending action, and trigger a clearly presented emergency stop; the resulting state must be reflected in the activity feed and approval queue, and the 3D scene must communicate emergency/blocked status in red.
- **Deliver Audit Trail and Settings sections with realistic seeded records and representative configuration controls.** Keep the existing application data flow and interactions; do not remove the current demo/Supabase loading behavior.
- **Deliver a working static route manifest and preserve project metadata.** Serve `/manus-routes.json` for the root page and preserve the existing project logo metadata.

## Cost tracking (existing open implementation outcomes)

- Add estimate-based `CostCalculator` with config-loaded model pricing.
- Persist estimated output tokens, model name, and calculated cost for every tool execution.
- Increment `agent_sessions.current_spend_usd` from logged tool costs.
- Add cached daily spend aggregation and dashboard cost trend/per-call cost display.
