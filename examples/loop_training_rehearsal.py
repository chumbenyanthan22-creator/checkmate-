"""Replay representative agent traces to rehearse and tune loop thresholds.

SovereignHalt is deliberately deterministic rather than an ML model. This rehearsal
is the safe first training step: collect traces, label legitimate polling versus
no-progress loops, and verify that the chosen threshold blocks only the latter.
"""
from __future__ import annotations

from sovereignhalt import LoopDetector, ToolCall


def replay(agent_id: str, calls: list[tuple[str, dict[str, str]]], threshold: int) -> list[str]:
    detector = LoopDetector(loop_threshold=threshold)
    return [detector.evaluate(ToolCall(agent_id, tool, args)).action for tool, args in calls]


if __name__ == "__main__":
    safe_polling = [("check_status", {"job_id": "job-1"})] * 2 + [("fetch_result", {"job_id": "job-1"})]
    no_progress = [("read_invoice", {"invoice_id": "INV-2048"})] * 5
    print("safe_polling:", replay("safe", safe_polling, threshold=3))
    print("no_progress:", replay("loop", no_progress, threshold=3))
    assert replay("safe", safe_polling, threshold=3) == ["allowed", "allowed", "allowed"]
    assert replay("loop", no_progress, threshold=3) == ["allowed", "allowed", "blocked", "blocked", "blocked"]
    print("loop rehearsal: passed")
