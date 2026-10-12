import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from agentbreaker.detector import Detector, ToolCall
guard = Detector(loop_threshold=3)
for step in range(1, 6):
    decision = guard.evaluate(ToolCall("demo", "search", {"page": 1}))
    print(f"step {step}: {decision.action} — {decision.reason}")
