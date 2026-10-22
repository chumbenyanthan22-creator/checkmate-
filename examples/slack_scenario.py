from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sovereignhalt import SlackAlerter


session_id = "local-slack-scenario"
loop_info = {
    "alert_type": "loop_detected",
    "loop_type": "repeat",
    "fingerprint": "9cf8fe2530d8a1b2c3d4e5f6",
    "cycle_length": 3,
}
print(f"SovereignHalt Slack alert scenario for session_id={session_id}")
if os.getenv("SOVEREIGNHALT_SEND_SLACK_SCENARIO") == "1":
    alerter = SlackAlerter.from_env()
    alerter.alert_loop(session_id, loop_info, "read_invoice")
    print("Slack alert scheduled without blocking the detector.")
    if alerter.webhook_url:
        time.sleep(0.2)  # Allow the daemon thread to submit in this short-lived scenario.
else:
    print("Dry run only. Set SOVEREIGNHALT_SEND_SLACK_SCENARIO=1 to send a real alert.")
