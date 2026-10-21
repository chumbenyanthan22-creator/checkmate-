# AgentBreaker client-ready MVP outcomes

- [x] **Deliver one dense AgentBreaker runtime cockpit, not a stacked landing page.** Use the supplied image only as visual inspiration: keep the app navigation, central neural core, compact operational panels, and useful controls in the same application view. Do not copy trading branding, data, or metrics.
- [x] **Remove fabricated dashboard data.** Do not show seeded/sample agents, policies, approvals, events, identities, workspace labels, counts, spend, percentages, or status claims as real. Show only values returned from an explicitly scoped workspace query; otherwise show a clear loading, workspace-not-configured, empty, or error state. Do not query tenant tables without `VITE_SUPABASE_WORKSPACE_ID` or query alert/tool-log tables without tenant scope.
- [x] **Keep the center a real autonomous 3D scene.** Use React Three Fiber, drei, and Three.js to render the procedural neural-core point cloud, scan geometry, and connected agent nodes in a WebGL Canvas—not an image or CSS mock. Core and particles move on their own by default, including with no agent records; pause/resume remains available, and reduced-motion preference lowers motion rather than silently stopping it.
- [x] **Keep all product sections in the same app shell.** Preserve Overview, Agent Registry, Policies, Approvals, Audit Trail, and Settings, add Plans & Pricing, and switch views without a page reload.
- [x] **Make operational controls and claims honest.** Existing local-only approval, policy, and emergency-stop controls must be identified as preview-only until persistence/runtime integrations exist. Export must contain only loaded records and real metadata.
- [x] **Add the requested pricing models.** Display a 30-day free trial, a Popular plan at `$299/month`, and an Enterprise plan at `$1,499/month`. Keep plan selection informational until a billing/checkout integration exists.
- [x] **Preserve the root route and project metadata.** Keep `/manus-routes.json` accurate for the single application route and preserve project logo metadata.

## Cost tracking (existing open implementation outcomes)

- [ ] Add estimate-based `CostCalculator` with config-loaded model pricing.
- [ ] Persist estimated output tokens, model name, and calculated cost for every tool execution.
- [ ] Increment `agent_sessions.current_spend_usd` from logged tool costs.
- [ ] Add cached daily spend aggregation and dashboard cost trend/per-call cost display.
