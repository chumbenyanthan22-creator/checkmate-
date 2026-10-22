# SovereignHalt detector proof

This proof uses a real Python handler, not seeded dashboard data.

```sh
pytest -q
python examples/looping_agent.py
```

The test agent intentionally sends the same `read_invoice` tool call five times. The handler evaluates each call before dispatch. The first two calls execute; the third and later calls are blocked by `loop_and_no_progress_detection` and never reach `tool()`.

Expected evidence:

```text
attempt=1 decision=allowed executed=True
attempt=2 decision=allowed executed=True
attempt=3 decision=blocked executed=False
```
