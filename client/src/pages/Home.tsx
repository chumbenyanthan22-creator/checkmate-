import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Database,
  Eye,
  FileCheck2,
  FileClock,
  FileText,
  Gauge,
  Headphones,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  Power,
  RefreshCw,
  Search,
  ServerCog,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";
import "../cyberpunk.css";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_WORKSPACE_ID, supabase } from "@/lib/supabase";
import { toast } from "sonner";

const AgentCoreScene = lazy(() => import("../components/AgentCoreScene"));

type ViewId = "overview" | "agents" | "policies" | "approvals" | "audit" | "settings";
type ActivityStatus = "allowed" | "blocked" | "approval";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";

type Agent = {
  id: string;
  name: string;
  description: string;
  icon: typeof Bot;
  status: "Active" | "Paused" | "Review";
  className: "Standard" | "Privileged";
  risk: RiskLevel;
  budget: string;
  calls: string;
  lastSeen: string;
  accent: string;
};

type ActivityEvent = {
  id: number;
  agent: string;
  agentId: string;
  action: string;
  detail: string;
  status: ActivityStatus;
  risk: RiskLevel;
  time: string;
  timeSort: number;
  cost?: string;
};

type SpendPoint = { day: string; total: number };

type Policy = {
  id: number;
  title: string;
  description: string;
  scope: string;
  state: boolean;
  icon: typeof Shield;
  accent: string;
};

const navItems: { id: ViewId; label: string; icon: typeof LayoutDashboard; badge?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "agents", label: "Agent Registry", icon: Bot, badge: "12" },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "approvals", label: "Approvals", icon: UserCheck, badge: "3" },
  { id: "audit", label: "Audit Trail", icon: FileClock },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const agents: Agent[] = [
  { id: "invoice", name: "Invoice Agent", description: "Reads invoices, matches purchase orders, and prepares payment drafts.", icon: FileText, status: "Active", className: "Privileged", risk: "High", budget: "$2.00 / session", calls: "1,284", lastSeen: "18 sec ago", accent: "mint" },
  { id: "support", name: "Support Resolution Agent", description: "Resolves tickets, drafts replies, and routes sensitive customer issues.", icon: Headphones, status: "Active", className: "Standard", risk: "Medium", budget: "$0.50 / session", calls: "8,921", lastSeen: "34 sec ago", accent: "violet" },
  { id: "vendor", name: "Vendor Verification Agent", description: "Verifies supplier identity, registration, and compliance evidence.", icon: FileCheck2, status: "Review", className: "Privileged", risk: "Critical", budget: "$1.25 / session", calls: "642", lastSeen: "2 min ago", accent: "amber" },
];

const baseActivity: ActivityEvent[] = [
  { id: 1, agent: "Invoice Agent", agentId: "invoice", action: "create_draft_payment", detail: "₹148,000 vendor payment draft", status: "approval", risk: "High", time: "1 min ago", timeSort: 1 },
  { id: 2, agent: "Support Resolution Agent", agentId: "support", action: "update_ticket", detail: "Ticket #4821 marked resolved", status: "allowed", risk: "Low", time: "3 min ago", timeSort: 3 },
  { id: 3, agent: "Vendor Verification Agent", agentId: "vendor", action: "export_vendor_data", detail: "External destination blocked", status: "blocked", risk: "Critical", time: "6 min ago", timeSort: 6 },
  { id: 4, agent: "Invoice Agent", agentId: "invoice", action: "read_invoice", detail: "Invoice INV-2048 parsed", status: "allowed", risk: "Low", time: "8 min ago", timeSort: 8 },
  { id: 5, agent: "Support Resolution Agent", agentId: "support", action: "send_email", detail: "Reply sent to customer", status: "allowed", risk: "Medium", time: "12 min ago", timeSort: 12 },
  { id: 6, agent: "Vendor Verification Agent", agentId: "vendor", action: "fetch_gst_record", detail: "Verification source responded", status: "allowed", risk: "Medium", time: "18 min ago", timeSort: 18 },
  { id: 7, agent: "Invoice Agent", agentId: "invoice", action: "read_invoice", detail: "Loop threshold reached", status: "blocked", risk: "High", time: "23 min ago", timeSort: 23 },
];

const seededPolicies: Policy[] = [
  { id: 1, title: "Privileged action approval", description: "Pause financial mutations and permission changes until a verified operator approves.", scope: "Privileged agents", state: true, icon: LockKeyhole, accent: "mint" },
  { id: 2, title: "Tool-call budget guard", description: "Stop sessions that exceed the assigned dollar or tool-call budget.", scope: "All agents", state: true, icon: CircleDollarSign, accent: "violet" },
  { id: 3, title: "Loop and no-progress detection", description: "Block repeated tool sequences when state or output does not advance.", scope: "All agents", state: true, icon: RefreshCw, accent: "amber" },
  { id: 4, title: "Tool access allowlist", description: "Allow only approved tools and schemas for each registered agent.", scope: "All tool calls", state: true, icon: ShieldCheck, accent: "mint" },
  { id: 5, title: "External data export", description: "Require approval before sensitive records leave the trusted workspace.", scope: "Data-handling tools", state: false, icon: Database, accent: "coral" },
];

const rangeMetrics: Record<string, { agents: string; actions: string; blocked: string; spend: string; delta: string }> = {
  "24h": { agents: "12", actions: "18.4k", blocked: "29", spend: "$1,284", delta: "+12.6%" },
  "7d": { agents: "16", actions: "92.8k", blocked: "184", spend: "$7,492", delta: "+21.4%" },
  "30d": { agents: "19", actions: "421.6k", blocked: "1,032", spend: "$34,901", delta: "+28.8%" },
};

const statusLabel: Record<ActivityStatus, string> = { allowed: "Allowed", blocked: "Blocked", approval: "Approval required" };
const riskClass: Record<RiskLevel, string> = { Low: "risk-low", Medium: "risk-medium", High: "risk-high", Critical: "risk-critical" };
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const iconForAgent = (slug: string) => ({ invoice: FileText, support: Headphones, vendor: FileCheck2 }[slug] ?? Bot);
const iconForPolicy = (title: string) => title.toLowerCase().includes("budget") ? CircleDollarSign : title.toLowerCase().includes("loop") ? RefreshCw : title.toLowerCase().includes("export") ? Database : title.toLowerCase().includes("privileged") ? LockKeyhole : ShieldCheck;
const relatedAgentField = (value: unknown, field: "name" | "slug") => { if (Array.isArray(value)) return (value[0] as Record<string, string> | undefined)?.[field]; if (value && typeof value === "object") return (value as Record<string, string>)[field]; return undefined; };
const formatUsd = (value: number) => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;

function LogoMark() {
  return <div className="logo-mark" aria-label="AgentBreaker logo"><ShieldCheck size={19} strokeWidth={2.5} /><span className="logo-break">/</span></div>;
}

function StatusPill({ status }: { status: ActivityStatus }) {
  const Icon = status === "allowed" ? CheckCircle2 : status === "blocked" ? XCircle : Clock3;
  return <span className={`status-pill status-${status}`}><Icon size={13} /> {statusLabel[status]}</span>;
}

function MetricCard({ label, value, helper, icon: Icon, accent }: { label: string; value: string; helper: string; icon: typeof Activity; accent: string }) {
  return <div className="metric-card"><div className={`metric-icon icon-${accent}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-helper"><ArrowUpRight size={13} /> {helper}</div></div>;
}

function ProgressBar({ value, color = "mint" }: { value: number; color?: string }) { return <div className="progress-track"><div className={`progress-fill fill-${color}`} style={{ width: `${value}%` }} /></div>; }

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [timeRange, setTimeRange] = useState("24h");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivityStatus>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [policies, setPolicies] = useState(seededPolicies);
  const [events, setEvents] = useState(baseActivity);
  const [approvals, setApprovals] = useState([
    { id: "APR-2048", agent: "Invoice Agent", action: "create_draft_payment", detail: "₹148,000 to Helius Components", risk: "High" as RiskLevel, age: "1 min ago" },
    { id: "APR-2044", agent: "Support Resolution Agent", action: "issue_refund", detail: "₹12,500 refund for ticket #4819", risk: "High" as RiskLevel, age: "8 min ago" },
    { id: "APR-2037", agent: "Vendor Verification Agent", action: "share_compliance_record", detail: "Share with new banking partner", risk: "Critical" as RiskLevel, age: "14 min ago" },
  ]);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dataSource, setDataSource] = useState<"seed" | "supabase">("seed");
  const [spendTrend, setSpendTrend] = useState<SpendPoint[]>([]);
  const [sessionSpend, setSessionSpend] = useState(0);
  const metrics = rangeMetrics[timeRange];
  const [liveAgents, setAgentsFromSupabase] = useState<Agent[] | null>(null);
  const activeAgents = liveAgents ?? agents;
  const selectedAgent = activeAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const filteredEvents = useMemo(() => events.filter((event) => (activityFilter === "all" || event.status === activityFilter) && (agentFilter === "all" || event.agentId === agentFilter)), [events, activityFilter, agentFilter]);

  useEffect(() => {
    let mounted = true;
    const loadLiveWorkspace = async () => {
      const [agentsResult, policiesResult, approvalsResult, auditResult, alertsResult, toolLogsResult] = await Promise.all([
        supabase.from("agents").select("id,slug,name,description,status,agent_class,risk_level,budget_cents,tool_calls,last_seen_at").eq("workspace_id", DEMO_WORKSPACE_ID).order("created_at"),
        supabase.from("policies").select("id,title,description,scope,enabled").eq("workspace_id", DEMO_WORKSPACE_ID).order("created_at"),
        supabase.from("approvals").select("id,reference,action,detail,risk_level,requested_at,agent_id,agents(name,slug)").eq("workspace_id", DEMO_WORKSPACE_ID).eq("status", "pending").order("requested_at"),
        supabase.from("audit_events").select("id,agent_id,agent_name,action,detail,outcome,risk_level,created_at,agents(slug)").eq("workspace_id", DEMO_WORKSPACE_ID).order("created_at", { ascending: false }).limit(12),
        supabase.from("agent_alerts").select("id,session_id,alert_type,fingerprint,cycle_length,created_at").order("created_at", { ascending: false }).limit(8),
        supabase.from("tool_execution_logs").select("session_id,agent_id,tool_name,cost_incurred,output_tokens_estimated,model_name,executed_at").order("executed_at", { ascending: false }).limit(1000),
      ]);
      if (!mounted || agentsResult.error || policiesResult.error || approvalsResult.error || auditResult.error || alertsResult.error || toolLogsResult.error) return;
      const liveAgents = (agentsResult.data ?? []).map((row) => ({
        id: row.slug,
        name: row.name,
        description: row.description,
        icon: iconForAgent(row.slug),
        status: titleCase(row.status) as Agent["status"],
        className: titleCase(row.agent_class) as Agent["className"],
        risk: titleCase(row.risk_level) as RiskLevel,
        budget: `$${(row.budget_cents / 100).toFixed(2)} / session`,
        calls: row.tool_calls.toLocaleString(),
        lastSeen: "live",
        accent: row.slug === "invoice" ? "mint" : row.slug === "support" ? "violet" : "amber",
      }));
      const livePolicies = (policiesResult.data ?? []).map((row) => ({ id: Number.parseInt(row.id.slice(0, 8), 16), title: row.title, description: row.description, scope: row.scope, state: row.enabled, icon: iconForPolicy(row.title), accent: row.title.toLowerCase().includes("export") ? "coral" : row.title.toLowerCase().includes("budget") ? "violet" : row.title.toLowerCase().includes("loop") ? "amber" : "mint" }));
      const liveApprovals = (approvalsResult.data ?? []).map((row) => ({ id: row.reference, agent: relatedAgentField(row.agents, "name") ?? "Agent", action: row.action, detail: row.detail, risk: titleCase(row.risk_level) as RiskLevel, age: "live" }));
      const liveEvents = (auditResult.data ?? []).map((row, index) => ({ id: index + 100, agent: row.agent_name, agentId: relatedAgentField(row.agents, "slug") ?? "workspace", action: row.action, detail: row.detail, status: row.outcome as ActivityStatus, risk: titleCase(row.risk_level) as RiskLevel, time: "live", timeSort: index }));
      const liveAlerts = (alertsResult.data ?? []).map((row, index) => ({ id: index + 1000, agent: "Live detector", agentId: "workspace", action: row.alert_type, detail: `Cycle length ${row.cycle_length} blocked before dispatch · ${row.fingerprint.slice(0, 10)}`, status: "blocked" as ActivityStatus, risk: "Critical" as RiskLevel, time: "live", timeSort: index }));
      const liveToolLogs = (toolLogsResult.data ?? []).map((row, index) => ({ id: index + 2000, agent: row.agent_id ? "Tracked agent" : "Live session", agentId: "workspace", action: row.tool_name, detail: `${row.model_name ?? "configured model"} · ${row.output_tokens_estimated ?? "~"} estimated output tokens`, status: "allowed" as ActivityStatus, risk: "Low" as RiskLevel, time: "live", timeSort: index, cost: formatUsd(Number(row.cost_incurred ?? 0)) }));
      const trend = new Map<string, number>();
      (toolLogsResult.data ?? []).forEach((row) => { const day = String(row.executed_at ?? "").slice(0, 10); trend.set(day, (trend.get(day) ?? 0) + Number(row.cost_incurred ?? 0)); });
      setSessionSpend((toolLogsResult.data ?? []).reduce((total, row) => total + Number(row.cost_incurred ?? 0), 0));
      setSpendTrend(Array.from(trend, ([day, total]) => ({ day, total })).sort((a, b) => a.day.localeCompare(b.day)));
      if (liveAgents.length && livePolicies.length && liveApprovals.length && liveEvents.length) {
        setAgentsFromSupabase(liveAgents);
        setPolicies(livePolicies);
        setApprovals(liveApprovals);
        setEvents([...liveAlerts, ...liveToolLogs, ...liveEvents]);
        setDataSource("supabase");
      }
    };
    void loadLiveWorkspace();
    return () => { mounted = false; };
  }, []);

  const setView = (view: ViewId) => { setActiveView(view); setSelectedAgentId(null); setMobileNavOpen(false); };
  const openAgent = (id: string) => { setActiveView("agents"); setSelectedAgentId(id); setMobileNavOpen(false); };
  const togglePolicy = (id: number) => { setPolicies((current) => current.map((policy) => policy.id === id ? { ...policy, state: !policy.state } : policy)); const policy = policies.find((item) => item.id === id); if (policy) toast.success(`${policy.title} ${policy.state ? "paused" : "enabled"}`); };
  const respondToApproval = (id: string, action: "approved" | "blocked") => {
    const approval = approvals.find((item) => item.id === id);
    if (!approval) return;
    setApprovals((current) => current.filter((item) => item.id !== id));
    const agentId = approval.agent.includes("Invoice") ? "invoice" : approval.agent.includes("Support") ? "support" : "vendor";
    setEvents((current) => [{ id: Date.now(), agent: approval.agent, agentId, action: approval.action, detail: `${approval.detail} · ${action}`, status: action === "approved" ? "allowed" : "blocked", risk: approval.risk, time: "just now", timeSort: 0 }, ...current]);
    toast[action === "approved" ? "success" : "error"](`${approval.action} ${action}`);
  };
  const triggerEmergencyStop = () => {
    const nextStopped = !emergencyStopped;
    setEmergencyStopped(nextStopped);
    if (nextStopped) setEvents((current) => [{ id: Date.now(), agent: "Workspace", agentId: "workspace", action: "emergency_stop", detail: "All autonomous actions paused by Rohan Kapoor", status: "blocked", risk: "Critical", time: "just now", timeSort: 0 }, ...current]);
    toast[nextStopped ? "error" : "success"](nextStopped ? "Emergency stop engaged across 12 agents" : "Runtime resumed");
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><LogoMark /><div><div className="brand-name">AgentBreaker</div><div className="brand-subtitle">Runtime control plane</div></div></div>
      <div className="workspace-switcher"><div className="workspace-avatar">A</div><div className="workspace-copy"><span>Acme Systems</span><small>Production workspace</small></div><ChevronDown size={15} /></div>
      <div className="nav-label">Control center</div>
      <nav className="nav-list">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${activeView === item.id ? "nav-item-active" : ""}`} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{item.badge && <span className="nav-badge">{item.id === "approvals" ? approvals.length : item.badge}</span>}</button>; })}</nav>
      <div className="sidebar-spacer" />
      <div className="runtime-card"><div className="runtime-card-header"><span className="live-dot" /> Runtime enforcement <span className="runtime-live">LIVE</span></div><p>All tool calls are evaluated before dispatch.</p><div className="runtime-stat"><span>Policy coverage</span><strong>98.4%</strong></div><ProgressBar value={98.4} /></div>
      <button className="user-card" onClick={() => setView("settings")}><div className="user-avatar">RK</div><div><strong>Rohan Kapoor</strong><small>Owner · Admin</small></div><MoreHorizontal size={17} /></button>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNavOpen((current) => !current)}><Menu size={20} /></button><div className="breadcrumb"><span>Control center</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === activeView)?.label}</strong></div><div className="topbar-actions"><div className="system-state"><span className="live-dot" /> {dataSource === "supabase" ? "Supabase synced" : "Demo data"}</div><button className="icon-button" aria-label="Notifications"><span className="notification-dot" /><Clock3 size={18} /></button><div className="topbar-divider" /><button className="icon-button" aria-label="Search"><Search size={18} /></button></div></header>
      {emergencyStopped && <div className="emergency-banner"><div><Power size={18} /><strong>Emergency stop engaged</strong><span>All autonomous actions are paused. Review the event stream before resuming.</span></div><button onClick={triggerEmergencyStop}>Resume runtime</button></div>}
      <div className="content-wrap">
        {activeView === "overview" && <OverviewView metrics={metrics} timeRange={timeRange} setTimeRange={setTimeRange} events={filteredEvents} activityFilter={activityFilter} setActivityFilter={setActivityFilter} agentFilter={agentFilter} setAgentFilter={setAgentFilter} approvals={approvals} onApproval={respondToApproval} onEmergencyStop={triggerEmergencyStop} emergencyStopped={emergencyStopped} onAgentSelect={openAgent} onOpenAudit={() => setView("audit")} onOpenApprovals={() => setView("approvals")} agents={activeAgents} spendTrend={spendTrend} sessionSpend={sessionSpend} />}
        {activeView === "agents" && <AgentsView agents={activeAgents} onSelect={setSelectedAgentId} selectedAgent={selectedAgent} onEmergencyStop={triggerEmergencyStop} emergencyStopped={emergencyStopped} />}
        {activeView === "policies" && <PoliciesView agents={activeAgents} policies={policies} onToggle={togglePolicy} />}
        {activeView === "approvals" && <ApprovalsView approvals={approvals} onRespond={respondToApproval} />}
        {activeView === "audit" && <AuditView events={events} />}
        {activeView === "settings" && <SettingsView emergencyStopped={emergencyStopped} onEmergencyStop={triggerEmergencyStop} />}
      </div>
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-header"><div><div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }

function OverviewView({ metrics, timeRange, setTimeRange, events, activityFilter, setActivityFilter, agentFilter, setAgentFilter, approvals, onApproval, onEmergencyStop, emergencyStopped, onAgentSelect, onOpenAudit, onOpenApprovals, agents, spendTrend, sessionSpend }: { metrics: typeof rangeMetrics["24h"]; timeRange: string; setTimeRange: (range: string) => void; events: ActivityEvent[]; activityFilter: "all" | ActivityStatus; setActivityFilter: (filter: "all" | ActivityStatus) => void; agentFilter: string; setAgentFilter: (filter: string) => void; approvals: { id: string; agent: string; action: string; detail: string; risk: RiskLevel; age: string }[]; onApproval: (id: string, action: "approved" | "blocked") => void; onEmergencyStop: () => void; emergencyStopped: boolean; onAgentSelect: (id: string) => void; onOpenAudit: () => void; onOpenApprovals: () => void; agents: Agent[]; spendTrend: SpendPoint[]; sessionSpend: number }) {
  return <><PageHeader eyebrow="Live protection" title="Good evening, Rohan." description="Your agents are operating within their defined boundaries." action={<div className="header-actions"><div className="select-wrap"><Clock3 size={15} /><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><ChevronDown size={15} /></div><button className={`stop-button ${emergencyStopped ? "resume-button" : ""}`} onClick={onEmergencyStop}>{emergencyStopped ? "Resume runtime" : "Emergency stop"}</button></div>} />
    <Suspense fallback={<section className="panel cp-scene-panel cp-scene-loading" aria-label="Loading 3D agent topology"><span className="cp-loading-orbit" />Loading live 3D topology…</section>}>
      <AgentCoreScene agents={agents} emergencyStopped={emergencyStopped} onAgentSelect={onAgentSelect} />
    </Suspense>
    <div className="metric-grid"><MetricCard label="Protected agents" value={metrics.agents} helper={`${metrics.delta} vs previous period`} icon={Bot} accent="mint" /><MetricCard label="Actions today" value={metrics.actions} helper="99.2% completed safely" icon={Activity} accent="violet" /><MetricCard label="Blocked actions" value={metrics.blocked} helper="4 critical events contained" icon={Shield} accent="coral" /><MetricCard label="Spend tracked" value={sessionSpend ? formatUsd(sessionSpend) : metrics.spend} helper={sessionSpend ? "estimated from tool outputs" : "awaiting live tool logs"} icon={CircleDollarSign} accent="amber" /></div>
    <div className="dashboard-grid"><section className="panel activity-panel"><div className="panel-header"><div><div className="panel-kicker"><span className="live-dot" /> Live activity</div><h2>Tool actions</h2></div><button className="text-button" onClick={onOpenAudit}>View full trail <ArrowUpRight size={15} /></button></div><div className="filter-row"><div className="segmented-control">{(["all", "allowed", "blocked", "approval"] as const).map((filter) => <button key={filter} className={activityFilter === filter ? "segment-active" : ""} onClick={() => setActivityFilter(filter)}>{filter === "all" ? "All actions" : statusLabel[filter]}</button>)}</div><div className="select-wrap compact"><Bot size={14} /><select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="all">All agents</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={14} /></div></div><div className="activity-list">{events.slice(0, 6).map((event) => <button className="activity-row" key={event.id} onClick={() => onAgentSelect(event.agentId)}><div className={`activity-icon activity-${event.status}`}><StatusIcon status={event.status} /></div><div className="activity-main"><div><strong>{event.action}</strong><span className="activity-agent">{event.agent}</span></div><p>{event.detail}</p></div><div className="activity-meta"><span className={`risk-tag ${riskClass[event.risk]}`}>{event.risk}</span><small>{event.time}</small>{event.cost && <small className="activity-cost">{event.cost}</small>}</div><ChevronRight size={15} className="row-chevron" /></button>)}{events.length === 0 && <div className="empty-state"><Eye size={18} />No actions match this filter.</div>}</div></section><section className="panel risk-panel"><div className="panel-header"><div><div className="panel-kicker">Risk posture</div><h2>Action distribution</h2></div><button className="icon-button subtle"><MoreHorizontal size={17} /></button></div><div className="risk-visual"><div className="donut"><div className="donut-core"><strong>18.4k</strong><span>actions</span></div></div><div className="risk-legend"><LegendItem label="Low risk" value="71.2%" color="mint" /><LegendItem label="Medium risk" value="20.4%" color="violet" /><LegendItem label="High risk" value="7.1%" color="amber" /><LegendItem label="Critical" value="1.3%" color="coral" /></div></div><div className="risk-footer"><span><ShieldCheck size={14} /> 98.4% policy coverage</span><span className="risk-footer-link">View policies <ChevronRight size={13} /></span></div></section></div>
    <SpendingTrend points={spendTrend} total={sessionSpend} />
    <div className="lower-grid"><section className="panel agents-mini-panel"><div className="panel-header"><div><div className="panel-kicker">Your fleet</div><h2>Protected agents</h2></div><button className="text-button" onClick={() => onAgentSelect("invoice")}>Open registry <ArrowUpRight size={15} /></button></div><div className="agent-mini-list">{agents.map((agent) => { const Icon = agent.icon; return <button key={agent.id} className="agent-mini-row" onClick={() => onAgentSelect(agent.id)}><div className={`agent-avatar agent-${agent.accent}`}><Icon size={18} /></div><div className="agent-mini-copy"><strong>{agent.name}</strong><span>{agent.className} · {agent.calls} calls</span></div><span className={`status-dot status-dot-${agent.status.toLowerCase()}`} /><small>{agent.lastSeen}</small><ChevronRight size={15} /></button>; })}</div></section><ApprovalPanel approvals={approvals} onRespond={onApproval} onOpen={onOpenApprovals} /></div>
  </>;
}

function SpendingTrend({ points, total }: { points: SpendPoint[]; total: number }) {
  const max = Math.max(...points.map((point) => point.total), 0.000001);
  return <section className="panel spending-panel"><div className="panel-header"><div><div className="panel-kicker"><CircleDollarSign size={13} /> Cost telemetry</div><h2>Daily spend trend</h2></div><strong className="spending-total">{total ? formatUsd(total) : "Awaiting logs"}</strong></div><div className="spending-chart">{points.length ? points.slice(-14).map((point) => <div className="spend-bar-wrap" key={point.day} title={`${point.day}: ${formatUsd(point.total)}`}><div className="spend-bar" style={{ height: `${Math.max(8, point.total / max * 100)}%` }} /><small>{point.day.slice(5)}</small></div>) : <div className="empty-state"><CircleDollarSign size={18} />No cost telemetry yet.</div>}</div></section>;
}

function StatusIcon({ status }: { status: ActivityStatus }) { return status === "allowed" ? <Check size={15} /> : status === "blocked" ? <X size={15} /> : <Clock3 size={15} />; }
function LegendItem({ label, value, color }: { label: string; value: string; color: string }) { return <div className="legend-item"><span className={`legend-swatch swatch-${color}`} /><span>{label}</span><strong>{value}</strong></div>; }

function ApprovalPanel({ approvals, onRespond, onOpen }: { approvals: { id: string; agent: string; action: string; detail: string; risk: RiskLevel; age: string }[]; onRespond: (id: string, action: "approved" | "blocked") => void; onOpen: () => void }) { return <section className="panel approval-panel"><div className="panel-header"><div><div className="panel-kicker"><span className="pulse-dot" /> Needs your decision</div><h2>Approval queue <span className="count-badge">{approvals.length}</span></h2></div><button className="icon-button subtle"><MoreHorizontal size={17} /></button></div><div className="approval-list">{approvals.slice(0, 2).map((approval) => <div className="approval-card" key={approval.id}><div className="approval-card-top"><span className={`risk-tag ${riskClass[approval.risk]}`}>{approval.risk} risk</span><small>{approval.age}</small></div><strong>{approval.action}</strong><p>{approval.detail}</p><div className="approval-agent"><div className="mini-avatar"><Bot size={14} /></div>{approval.agent}<span>·</span>{approval.id}</div><div className="approval-actions"><button className="approve-button" onClick={() => onRespond(approval.id, "approved")}><Check size={14} /> Approve</button><button className="block-button" onClick={() => onRespond(approval.id, "blocked")}><X size={14} /> Block</button></div></div>)}{approvals.length === 0 && <div className="empty-state"><CheckCircle2 size={18} />Queue cleared. Nice work.</div>}</div><button className="panel-footer-button" onClick={onOpen}>Open approval queue <ChevronRight size={15} /></button></section>; }

function AgentsView({ agents, onSelect, selectedAgent, onEmergencyStop, emergencyStopped }: { agents: Agent[]; onSelect: (id: string) => void; selectedAgent: Agent | null; onEmergencyStop: () => void; emergencyStopped: boolean }) { return <><PageHeader eyebrow="Agent registry" title="Your protected fleet" description="Know every agent. Bound every action. Keep autonomy accountable." action={<button className={`stop-button ${emergencyStopped ? "resume-button" : ""}`} onClick={onEmergencyStop}>{emergencyStopped ? "Resume runtime" : "Emergency stop"}</button>} /><div className="registry-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search agents, tools, owners..." /><span>⌘ K</span></div><div className="select-wrap compact"><SlidersHorizontal size={14} /><select><option>All statuses</option><option>Active</option><option>Paused</option></select><ChevronDown size={14} /></div><button className="secondary-button"><Code2 size={15} /> Add agent</button></div>{selectedAgent ? <AgentDetail agent={selectedAgent} onBack={() => onSelect("")} /> : <div className="registry-grid">{agents.map((agent) => { const Icon = agent.icon; return <button key={agent.id} className="agent-card" onClick={() => onSelect(agent.id)}><div className="agent-card-head"><div className={`agent-avatar agent-${agent.accent}`}><Icon size={20} /></div><span className={`agent-status agent-status-${agent.status.toLowerCase()}`}><span className="status-dot" />{agent.status}</span></div><h3>{agent.name}</h3><p>{agent.description}</p><div className="agent-card-meta"><span className="meta-label">Class</span><strong>{agent.className}</strong><span className="meta-label">Risk</span><strong className={riskClass[agent.risk]}>{agent.risk}</strong><span className="meta-label">Budget</span><strong>{agent.budget}</strong></div><div className="agent-card-footer"><span><Activity size={14} /> {agent.calls} tool calls</span><span>Seen {agent.lastSeen}</span><ChevronRight size={15} /></div></button>; })}</div>}</>; }

function AgentDetail({ agent, onBack }: { agent: Agent; onBack: () => void }) { const Icon = agent.icon; return <div className="detail-view"><button className="back-button" onClick={onBack}>← Back to registry</button><div className="detail-hero"><div className={`agent-avatar agent-${agent.accent} large`}><Icon size={27} /></div><div><div className="eyebrow"><span className="eyebrow-line" />Agent profile</div><h2>{agent.name}</h2><p>{agent.description}</p></div><span className={`agent-status agent-status-${agent.status.toLowerCase()}`}><span className="status-dot" />{agent.status}</span></div><div className="detail-grid"><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Governance profile</div><h2>Boundaries & permissions</h2></div><button className="secondary-button"><Settings2 size={15} /> Edit profile</button></div><div className="boundary-list"><BoundaryRow icon={LockKeyhole} title="Agent class" value={agent.className} status="Enforced" /><BoundaryRow icon={CircleDollarSign} title="Session budget" value={agent.budget} status="Enforced" /><BoundaryRow icon={ShieldCheck} title="Approval policy" value="Privileged mutations" status="Active" /><BoundaryRow icon={RefreshCw} title="Loop detector" value="Jaccard + sequence" status="Active" /></div></section><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Activity health</div><h2>Last 24 hours</h2></div><Activity size={17} className="muted-icon" /></div><div className="detail-stat-grid"><div><strong>{agent.calls}</strong><span>tool calls</span></div><div><strong>99.1%</strong><span>safe completion</span></div><div><strong>14</strong><span>approvals</span></div><div><strong>3</strong><span>blocked</span></div></div><div className="sparkline"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div></section></div><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Recent actions</div><h2>Decision log</h2></div><button className="text-button">Open full trail <ArrowUpRight size={15} /></button></div><div className="activity-list compact-list">{baseActivity.filter((event) => event.agentId === agent.id).slice(0, 4).map((event) => <div className="activity-row static-row" key={event.id}><div className={`activity-icon activity-${event.status}`}><StatusIcon status={event.status} /></div><div className="activity-main"><div><strong>{event.action}</strong></div><p>{event.detail}</p></div><div className="activity-meta"><span className={`risk-tag ${riskClass[event.risk]}`}>{event.risk}</span><small>{event.time}</small>{event.cost && <small className="activity-cost">{event.cost}</small>}</div></div>)}</div></section></div>; }

function BoundaryRow({ icon: Icon, title, value, status }: { icon: typeof Shield; title: string; value: string; status: string }) { return <div className="boundary-row"><div className="boundary-icon"><Icon size={16} /></div><div><strong>{title}</strong><span>{value}</span></div><span className="boundary-status"><CheckCircle2 size={14} /> {status}</span></div>; }

function PoliciesView({ agents, policies, onToggle }: { agents: Agent[]; policies: Policy[]; onToggle: (id: number) => void }) { const activePolicyCount = policies.filter((policy) => policy.state).length; return <><PageHeader eyebrow="Runtime governance" title="Policies" description="Define what your agents can do before they act." action={<button className="secondary-button"><Sparkles size={15} /> New policy</button>} /><div className="policy-banner"><div className="policy-banner-icon"><ShieldCheck size={22} /></div><div><strong>Policy enforcement is active</strong><p>Every tool call is evaluated locally before it leaves the agent runtime.</p></div><div className="policy-banner-stat"><span>{activePolicyCount} active policies</span><strong>98.4% coverage</strong></div></div><div className="policy-list">{policies.map((policy) => { const Icon = policy.icon; return <div className="policy-row" key={policy.id}><div className={`policy-icon icon-${policy.accent}`}><Icon size={18} /></div><div className="policy-copy"><div><h3>{policy.title}</h3><span className="scope-tag">{policy.scope}</span></div><p>{policy.description}</p></div><div className="policy-state"><span className={`state-label ${policy.state ? "state-on" : "state-off"}`}>{policy.state ? "Active" : "Paused"}</span><button className={`toggle ${policy.state ? "toggle-on" : ""}`} onClick={() => onToggle(policy.id)} aria-label={`Toggle ${policy.title}`}><span /></button><MoreHorizontal size={18} className="muted-icon" /></div></div>; })}</div><div className="two-col-panels"><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Policy health</div><h2>Coverage by agent</h2></div></div>{agents.map((agent) => { const Icon = agent.icon; return <div className="coverage-row" key={agent.id}><div className="coverage-agent"><div className={`mini-avatar agent-${agent.accent}`}><Icon size={14} /></div><span>{agent.name}</span></div><ProgressBar value={agent.id === "vendor" ? 89 : agent.id === "invoice" ? 100 : 96} color={agent.id === "vendor" ? "amber" : "mint"} /><strong>{agent.id === "vendor" ? "89%" : agent.id === "invoice" ? "100%" : "96%"}</strong></div>; })}</section><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Guardrail recipes</div><h2>Recommended next</h2></div></div><div className="recipe-list"><div><Sparkles size={16} /><span>Prompt injection shield</span><button className="text-button">Configure</button></div><div><Network size={16} /><span>Agent-to-agent allowlist</span><button className="text-button">Configure</button></div><div><ServerCog size={16} /><span>Private tool gateway</span><button className="text-button">Configure</button></div></div></section></div></>; }

function ApprovalsView({ approvals, onRespond }: { approvals: { id: string; agent: string; action: string; detail: string; risk: RiskLevel; age: string }[]; onRespond: (id: string, action: "approved" | "blocked") => void }) { return <><PageHeader eyebrow="Human-in-the-loop" title="Approvals" description="High-impact actions pause here until a verified operator decides." action={<div className="header-chip"><Clock3 size={15} /> {approvals.length} pending decisions</div>} /><div className="approval-page-grid"><section className="panel"><div className="panel-header"><div><div className="panel-kicker">Needs attention</div><h2>Pending decisions</h2></div><button className="secondary-button"><SlidersHorizontal size={15} /> Filter</button></div><div className="approval-page-list">{approvals.map((approval) => <div className="approval-page-card" key={approval.id}><div className="approval-page-main"><div className="approval-card-top"><span className={`risk-tag ${riskClass[approval.risk]}`}>{approval.risk} risk</span><span className="approval-id">{approval.id}</span><small>{approval.age}</small></div><h3>{approval.action}</h3><p>{approval.detail}</p><div className="approval-agent"><div className="mini-avatar"><Bot size={14} /></div>{approval.agent} <span>·</span> Privileged mutation</div></div><div className="approval-page-actions"><button className="approve-button" onClick={() => onRespond(approval.id, "approved")}><Check size={14} /> Approve</button><button className="block-button" onClick={() => onRespond(approval.id, "blocked")}><X size={14} /> Block</button></div></div>)}{approvals.length === 0 && <div className="empty-state tall"><CheckCircle2 size={22} />No pending actions. Your queue is clear.</div>}</div></section><section className="panel decision-panel"><div className="panel-header"><div><div className="panel-kicker">Decision context</div><h2>Before you approve</h2></div><ShieldCheck size={18} className="muted-icon" /></div><div className="context-list"><ContextRow icon={UserCheck} title="Initiated by" value="Rohan Kapoor · Owner" /><ContextRow icon={Gauge} title="Policy match" value="Privileged action approval" /><ContextRow icon={CircleDollarSign} title="Spend impact" value="$0.04 estimated" /><ContextRow icon={Database} title="Data accessed" value="Invoice + vendor record" /></div><div className="approval-note"><AlertTriangle size={16} /><span>Approvals expire after 60 minutes. Blocked actions are recorded in the audit trail.</span></div></section></div></>; }
function ContextRow({ icon: Icon, title, value }: { icon: typeof UserCheck; title: string; value: string }) { return <div className="context-row"><div className="context-icon"><Icon size={15} /></div><div><span>{title}</span><strong>{value}</strong></div></div>; }

function AuditView({ events }: { events: ActivityEvent[] }) { return <><PageHeader eyebrow="Evidence layer" title="Audit trail" description="A complete record of what every agent tried to do, and why it was allowed or stopped." action={<button className="secondary-button"><FileText size={15} /> Export report</button>} /><div className="audit-summary"><div><strong>18,421</strong><span>events retained</span></div><div><strong>99.98%</strong><span>audit availability</span></div><div><strong>24h</strong><span>last indexed</span></div><div><strong>0</strong><span>missing records</span></div></div><section className="panel audit-panel"><div className="audit-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search actions, agents, IDs..." /></div><div className="select-wrap compact"><select><option>All outcomes</option><option>Allowed</option><option>Blocked</option><option>Approval</option></select><ChevronDown size={14} /></div><button className="icon-button subtle"><SlidersHorizontal size={17} /></button></div><div className="audit-table"><div className="audit-table-head"><span>Outcome</span><span>Action</span><span>Agent</span><span>Risk</span><span>Cost</span><span>Time</span></div>{events.map((event) => <div className="audit-table-row" key={event.id}><StatusPill status={event.status} /><div><strong>{event.action}</strong><small>{event.detail}</small></div><span>{event.agent}</span><span className={`risk-tag ${riskClass[event.risk]}`}>{event.risk}</span><span className="audit-cost">{event.cost ?? "—"}</span><span className="audit-time">{event.time}</span><ChevronRight size={15} /></div>)}</div></section></>; }

function SettingsView({ emergencyStopped, onEmergencyStop }: { emergencyStopped: boolean; onEmergencyStop: () => void }) { return <><PageHeader eyebrow="Workspace configuration" title="Settings" description="Configure the control plane without losing visibility or control." action={<button className="secondary-button"><RefreshCw size={15} /> Sync status</button>} /><div className="settings-layout"><div className="settings-nav"><button className="settings-nav-active"><Settings2 size={16} /> Workspace</button><button><ShieldCheck size={16} /> Security</button><button><Clock3 size={16} /> Notifications</button><button><Code2 size={16} /> Developer tools</button></div><div className="settings-content"><section className="panel settings-panel"><div className="panel-header"><div><div className="panel-kicker">Workspace</div><h2>Acme Systems</h2></div><span className="connected-pill"><span className="status-dot" /> Connected</span></div><SettingRow title="Workspace ID" value="acme-prod-7f29" /><SettingRow title="Default runtime mode" value="Enforce" control={<div className="select-wrap compact"><select defaultValue="enforce"><option value="enforce">Enforce</option><option value="observe">Observe only</option></select><ChevronDown size={14} /></div>} /><SettingRow title="Telemetry retention" value="90 days" control={<div className="select-wrap compact"><select defaultValue="90"><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select><ChevronDown size={14} /></div>} /></section><section className="panel settings-panel danger-zone"><div className="panel-header"><div><div className="panel-kicker">Critical controls</div><h2>Runtime controls</h2></div><Power size={18} className="muted-icon" /></div><div className="danger-row"><div><strong>Emergency stop</strong><p>Pause all autonomous tool actions across this workspace.</p></div><button className={`stop-button ${emergencyStopped ? "resume-button" : ""}`} onClick={onEmergencyStop}>{emergencyStopped ? "Resume runtime" : "Engage stop"}</button></div><div className="danger-row"><div><strong>Rotate runtime keys</strong><p>Invalidate and re-issue credentials for connected agents.</p></div><button className="secondary-button">Rotate keys</button></div></section></div></div></>; }
function SettingRow({ title, value, control }: { title: string; value: string; control?: ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><span>{value}</span></div>{control ?? <ChevronRight size={16} className="muted-icon" />}</div>; }
