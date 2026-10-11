# Checkmate

Pre-dispatch guard for AI agents. Kills identical tool loops and hard-caps a session before the next model or tool call goes out.

## 1. Install

```bash
git clone https://github.com/chumbenyanthan22-creator/checkmate-.git
cd checkmate-
pip install -e .
```

Python 3.11+. The zero-dependency demo below does not need this install.

## 2. Demo

```bash
python examples/loop_demo.py
```

Base Python only. You should see the third identical call blocked, then a session with changing arguments die at `max_iterations`.

## 3. LangChain

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

`CheckmateHandler` blocks inside `on_tool_start` before the tool runs. Identical calls trip the loop rule. Calls whose arguments keep changing still stop when the session crosses `max_iterations`.
