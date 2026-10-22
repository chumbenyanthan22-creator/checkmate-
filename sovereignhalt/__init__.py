"""SovereignHalt Python SDK.

The distribution and recommended import namespace are ``sovereignhalt``.
The historical ``agentbreaker`` package remains supported for compatibility.
"""
from agentbreaker import (
    BudgetExceededException,
    CheckmateHandler,
    Decision,
    Detector,
    EnforcementHandler,
    EnforcementResult,
    HandlerResult,
    LoopBreakerHandler,
    LoopDetectedException,
    LoopDetector,
    ToolCall,
)
from agentbreaker.cost_calculator import CostCalculator
from agentbreaker.slack_alerter import SlackAlerter
from agentbreaker.supabase_logger import SupabaseLogger

__version__ = "0.1.0"

__all__ = [
    "BudgetExceededException",
    "CheckmateHandler",
    "CostCalculator",
    "Decision",
    "Detector",
    "EnforcementHandler",
    "EnforcementResult",
    "HandlerResult",
    "LoopBreakerHandler",
    "LoopDetectedException",
    "LoopDetector",
    "SlackAlerter",
    "SupabaseLogger",
    "ToolCall",
]
