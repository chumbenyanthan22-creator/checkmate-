def test_sovereignhalt_namespace_reexports_legacy_implementation():
    import sovereignhalt
    from agentbreaker.callback import CheckmateHandler as LegacyCheckmateHandler
    from agentbreaker.detector import Detector as LegacyDetector
    from agentbreaker.langchain_handler import LoopBreakerHandler as LegacyLoopBreakerHandler
    from agentbreaker.slack_alerter import SlackAlerter as LegacySlackAlerter
    from agentbreaker.supabase_logger import SupabaseLogger as LegacySupabaseLogger

    assert sovereignhalt.__version__ == "0.1.0"
    assert sovereignhalt.CheckmateHandler is LegacyCheckmateHandler
    assert sovereignhalt.Detector is LegacyDetector
    assert sovereignhalt.LoopBreakerHandler is LegacyLoopBreakerHandler
    assert sovereignhalt.SlackAlerter is LegacySlackAlerter
    assert sovereignhalt.SupabaseLogger is LegacySupabaseLogger


def test_slack_asgi_app_is_shared_by_both_namespaces():
    from agentbreaker.slack_webhook_handler import app as legacy_app
    from sovereignhalt.slack_webhook_handler import app as sovereignhalt_app

    assert sovereignhalt_app is legacy_app
