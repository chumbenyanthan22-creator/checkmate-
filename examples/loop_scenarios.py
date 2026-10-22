#!/usr/bin/env python3
"""Zero-dependency SovereignHalt loop-guard scenarios.

Checks an identical tool loop and a max_iterations hard cap without external services.

Run from repo root:
  python examples/loop_scenarios.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow running without install: python examples/loop_scenarios.py
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sovereignhalt import Detector, ToolCall  # noqa: E402


def scenario_identical_loop() -> None:
    print("=== Scenario 1: identical tool loop ===")
    detector = Detector(loop_threshold=3)
    agent_id = "scenario-agent"
    args = {"query": "status"}

    for i in range(1, 5):
        call = ToolCall(agent_id=agent_id, tool="search", arguments=args)
        decision = detector.evaluate(call)
        print(f"  call {i}: {decision.action} — {decision.reason}")
        if decision.action == "blocked":
            print("  ✓ Loop stopped before another dispatch\n")
            return
    print("  ✗ Expected a block\n")


def scenario_max_iterations() -> None:
    print("=== Scenario 2: max_iterations hard cap ===")
    detector = Detector(loop_threshold=99, max_iterations=5)
    agent_id = "budget-agent"

    for i in range(1, 8):
        # Vary args so fingerprint loop never triggers — only max_iterations should.
        call = ToolCall(agent_id=agent_id, tool="fetch", arguments={"page": i})
        decision = detector.evaluate(call)
        print(f"  step {i}: {decision.action} — {decision.reason}")
        if decision.action == "blocked":
            print("  ✓ Hard step cap enforced\n")
            return
    print("  ✗ Expected a block\n")


def main() -> None:
    print("SovereignHalt — pre-dispatch guard scenarios (no API keys, no Supabase)\n")
    scenario_identical_loop()
    scenario_max_iterations()
    print("Done. Integrate Detector / LoopBreakerHandler before your next model or tool call.")


if __name__ == "__main__":
    main()
