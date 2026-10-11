"""Loop detection and cost tracking for LangChain agents."""

from .callback import CheckmateHandler
from .detector import Decision, Detector, ToolCall
from .handler import EnforcementHandler, EnforcementResult
from .langchain_handler import BudgetExceededException, HandlerResult, LoopBreakerHandler, LoopDetectedException

# Preferred public name; retain Detector as a compatibility alias.
LoopDetector = Detector

__all__ = [
    "Decision",
    "BudgetExceededException",
    "CheckmateHandler",
    "Detector",
    "EnforcementHandler",
    "EnforcementResult",
    "HandlerResult",
    "LoopBreakerHandler",
    "LoopDetectedException",
    "LoopDetector",
    "ToolCall",
]
