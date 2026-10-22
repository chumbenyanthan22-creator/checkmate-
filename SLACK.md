# SovereignHalt Slack loop alerts

Set `SLACK_WEBHOOK_URL` in the backend environment. The `SupabaseLogger` accepts a `SlackAlerter` and schedules the Block Kit POST on a daemon thread so detector enforcement never waits on Slack.

For a public interactivity endpoint, also set `SLACK_SIGNING_SECRET`. The endpoint verifies Slack's timestamped HMAC signature before parsing the form. If no Continue/Kill response arrives, `SOVEREIGNHALT_SLACK_TIMEOUT_SECONDS` (default: 60) pauses the session as the safe default. The former `AGENTBREAKER_SLACK_TIMEOUT_SECONDS` variable remains a fallback for existing installations.

## Local run

Install the optional webhook dependencies with `pip install -e ".[web]"` before starting the ASGI app.

```sh
python examples/slack_scenario.py
# Explicitly opt in only when you want to send a real alert:
SOVEREIGNHALT_SEND_SLACK_SCENARIO=1 python examples/slack_scenario.py
uvicorn sovereignhalt.slack_webhook_handler:app --host 0.0.0.0 --port 8000
```

The scenario runs in dry-run mode by default and never sends a Slack message unless the opt-in variable is set.

Configure the Slack app’s Interactivity Request URL as:

```text
https://<backend-origin>/webhook/slack
```

The Continue button resets the registered detector session and resumes it when the logger supports `resume_session`. Kill calls `pause_session` and keeps the session paused.

## Deployment

The repository includes `api/webhook/slack.py` for Vercel’s Python runtime and a `Procfile` for Railway or any Procfile-compatible host. The current Vercel project was originally configured as a static frontend; deployment of the Python function requires enabling/authorizing the Vercel connector or connecting the repository in Vercel.

The in-memory session registry is suitable for a prototype. A production multi-instance deployment should persist Continue/Kill control state in Supabase or use a durable backend so a Slack callback can reach the correct detector process.
