# SovereignHalt

Real-agent runtime observability with a pre-dispatch guard for AI tool loops. Stop repeated tool calls and enforce a hard session limit before the next model or tool call goes out.

## 1. Install the Python SDK

```bash
git clone https://github.com/chumbenyanthan22-creator/checkmate-.git
cd checkmate-
pip install -e .
```

Python 3.11+. The local scenarios below use no API key or external service.

## 2. Run local guard scenarios

```bash
python examples/loop_scenarios.py
```

The script checks that an identical tool loop is blocked and that a session with changing arguments stops at `max_iterations`.

## 3. LangChain integration

```python
from agentbreaker import CheckmateHandler

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
