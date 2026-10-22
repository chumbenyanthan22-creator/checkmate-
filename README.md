# SovereignHalt

Real-agent runtime observability with a pre-dispatch guard for AI tool loops. Stop repeated tool calls and enforce a hard session limit before the next model or tool call goes out.

## 1. Install the Python SDK

```bash
git clone https://github.com/chumbenyanthan22-creator/checkmate-.git
cd checkmate-
pip install -e .
```

Python 3.11+. The local scenarios below use no API key or external service. The installable package and recommended import namespace are `sovereignhalt`; the existing `agentbreaker` imports remain available for backward compatibility.

## 2. Run local guard scenarios

```bash
python examples/loop_scenarios.py
```

The script checks that an identical tool loop is blocked and that a session with changing arguments stops at `max_iterations`.

## Connect an actual agent to SovereignHalt

Local scenarios are offline examples and never register dashboard agents. First add the real producer to Vercel's server-only `SOVEREIGNHALT_INGEST_AGENTS_JSON` registry. Give each producer a unique random token of at least 32 characters, and record its canonical name and stable slug in the same entry. The bearer token selects that server-owned profile; producer-supplied identity fields are not accepted. Never expose registry tokens to browser code or commit them. For example, the Vercel value is a JSON array like:

```bash
SOVEREIGNHALT_INGEST_AGENTS_JSON=[{"name":"<actual-agent-name>","slug":"<stable-agent-slug>","token":"<unique-high-entropy-token>","agent_class":"standard","risk_level":"low"}]
```

Configure that producer's runtime with the matching token and explicit local identity for the SDK/callback configuration. These local identity labels are not transmitted or used to select the dashboard profile; the per-agent token is authoritative:

```bash
SOVEREIGNHALT_INGEST_URL=https://<your-vercel-domain>/api/telemetry/ingest
SOVEREIGNHALT_INGEST_TOKEN=<this-agent's-unique-token>
SOVEREIGNHALT_AGENT_NAME=<actual-agent-name>
SOVEREIGNHALT_AGENT_SLUG=<stable-agent-slug>
```

Enable telemetry explicitly in the callback used by that agent:

```python
from sovereignhalt import CheckmateHandler

handler = CheckmateHandler(
    session_id="<runtime-session-id>",
    telemetry_enabled=True,
    agent_name="<actual-agent-name>",
    agent_slug="<stable-agent-slug>",
    agent_id="<optional-agent-uuid>",
    loop_threshold=3,
    max_iterations=8,
)
result = agent.invoke({"input": "..."}, config={"callbacks": [handler]})
```

The callback sends only an event containing a bounded tool-action identifier, an explicit structured guard signal, and a stable event ID. The server derives canonical agent identity from the bearer token and derives outcome, status, risk, detail, and timestamp from the signal; free-form reasons, tool arguments, outputs, and customer payloads are not accepted. Loop Detected is recorded only for the detector's explicit repeated-sequence signal; budget and iteration-limit blocks remain distinct. API-only SDK mode needs the per-agent ingestion token but no Supabase service-role key. Missing or unregistered credentials fail closed and never create a dashboard-visible placeholder agent. A real agent appears only after its first successful event is linked to its registered profile.

Optional legacy direct-Supabase mode remains available for the repository's session and cost tables only when `SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE=true` is explicitly set in a trusted server runtime. It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or a legacy `SUPABASE_KEY` that declares `role=service_role`/`sb_secret_`). API-only mode ignores database credentials, even if present. Never put a service-role credential in browser code. Direct mode does not write dashboard decision events; those require the protected ingestion API and an explicit structured signal.

The Vercel entrypoints are the two TypeScript wrappers in `api/telemetry/`; Vercel's Node runtime supports TypeScript functions in the project-root `/api` directory ([runtime documentation](https://vercel.com/docs/functions/runtimes/node-js)). Shared handlers and tests stay under `server/api/telemetry/` and `tests/api/telemetry/`, so they are not treated as extra public functions. Local `pnpm dev` mounts the same handlers before Express's general body parsers; ingestion rejects bodies over 4 KiB while reading the raw stream, before JSON parsing. For legacy direct database writes, existing UUID session IDs are preserved and other session/company strings map deterministically to UUID keys; cost aggregation uses the same session mapping.

## 3. LangChain integration

```python
from sovereignhalt import CheckmateHandler

handler = CheckmateHandler(session_id="pilot", loop_threshold=3, max_iterations=8)

# Any LangChain runnable or agent:
result = agent.invoke(
    {"input": "reconcile invoice INV-1"},
    config={"callbacks": [handler]},
)
```

Run the same callback against a local looping agent (no API key):

```bash
python examples/langchain_loop.py
```

`CheckmateHandler` is the existing SDK API name; it blocks inside `on_tool_start` before the tool runs. Identical calls trip the loop rule. Calls whose arguments keep changing still stop when the session crosses `max_iterations`.
