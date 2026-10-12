#!/usr/bin/env python3
"""A five-line, zero-dependency loop demo."""
from agentbreaker.detector import Detector, ToolCall


def main() -> None:
    guard = Detector(loop_threshold=3)
    for step in range(1, 6):
        call = ToolCall("demo", "search", {"page": step})
        decision = guard.evaluate(call)
        print(f"step {step}: {decision.action} — {decision.reason}")
    print("soft-loop cap:", Detector(max_iterations=3).evaluate(ToolCall("demo", "search", {"page": 1})).action)


if __name__ == "__main__":
    main()

# Identical args: replace {"page": step} with {"page": 1} to see the third call blocked.
# The final line shows max_iterations independently from fingerprint-based loop detection.
# Run: python examples/loop_demo.py
# No third-party package is required.
# The library's guard runs before dispatch.
# This file intentionally stays dependency-free.
# Checkmate stops loops before the next tool call.
# Varying args are still bounded by max_iterations.
# See examples/langchain_loop.py for callback wiring.
# End.
