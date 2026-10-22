#!/usr/bin/env python3
"""End-to-end looping agent stopped by the existing CheckmateHandler API.

No API key. No Supabase. Same object you pass as callbacks=[CheckmateHandler(...)].

  python examples/langchain_loop.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sovereignhalt import CheckmateHandler, LoopDetectedException  # noqa: E402


def run_looping_agent(handler: CheckmateHandler, calls: list[tuple[str, dict]]) -> str:
    """Stand-in for an agent that keeps calling tools until the guard stops it."""
    for step, (tool_name, args) in enumerate(calls, start=1):
        print(f"step {step}: {tool_name}({args})", flush=True)
        try:
            handler.on_tool_start({"name": tool_name}, "", inputs=args)
        except LoopDetectedException as exc:
            print(f"LOOP DETECTED — {exc}", flush=True)
            return "blocked"
        print("  dispatched", flush=True)
    return "finished"


def main() -> None:
    print("SovereignHalt LangChain callback — looping agent\n", flush=True)

    print("--- identical tool loop ---", flush=True)
    identical = CheckmateHandler(session_id="loop-scenario", loop_threshold=3, max_iterations=20)
    status = run_looping_agent(
        identical,
        [("search", {"q": "invoice status"})] * 5,
    )
    if status != "blocked":
        raise SystemExit("expected the identical loop to be blocked")

    print("\n--- soft loop (args change every step) ---", flush=True)
    soft = CheckmateHandler(session_id="soft-scenario", loop_threshold=99, max_iterations=4)
    status = run_looping_agent(
        soft,
        [("search", {"q": f"page-{i}"}) for i in range(1, 8)],
    )
    if status != "blocked":
        raise SystemExit("expected max_iterations to stop the soft loop")

    try:
        from langchain_core.callbacks import BaseCallbackHandler

        wired = CheckmateHandler(session_id="lc", max_iterations=3)
        if not isinstance(wired, BaseCallbackHandler):
            raise SystemExit("CheckmateHandler is not a LangChain callback")
        print("\nlangchain-core: callbacks=[CheckmateHandler(...)] type check passed", flush=True)
    except ImportError:
        print("\nlangchain-core not installed — callback still ran without it", flush=True)

    print("\nDone.", flush=True)


if __name__ == "__main__":
    main()
