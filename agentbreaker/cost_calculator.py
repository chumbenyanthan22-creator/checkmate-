from __future__ import annotations

from datetime import datetime
import json
import math
import os
from pathlib import Path
from typing import Any

from .session_ids import schema_uuid

DEFAULT_PRICING_PATH = Path(__file__).with_name("pricing_config.json")


class CostCalculator:
    """Estimate output-token cost without calling a model provider."""

    def __init__(self, pricing_config: dict[str, float], supabase_client: Any | None = None) -> None:
        self.pricing_config = {str(name): float(rate) for name, rate in pricing_config.items()}
        self.supabase_client = supabase_client

    @classmethod
    def from_config_file(cls, path: str | Path | None = None, supabase_client: Any | None = None) -> "CostCalculator":
        config_path = Path(path or os.getenv("SOVEREIGNHALT_PRICING_CONFIG") or os.getenv("AGENTBREAKER_PRICING_CONFIG") or DEFAULT_PRICING_PATH)
        with config_path.open(encoding="utf-8") as stream:
            return cls(json.load(stream), supabase_client=supabase_client)

    def _rate(self, model_name: str) -> float:
        if model_name in self.pricing_config:
            return self.pricing_config[model_name]
        for prefix, rate in self.pricing_config.items():
            if model_name.startswith(prefix):
                return rate
        raise ValueError(f"No pricing configured for model: {model_name}")

    def estimate_cost(self, tool_call_output_length: int | str, model_name: str) -> float:
        output_length = len(tool_call_output_length) if isinstance(tool_call_output_length, str) else max(0, int(tool_call_output_length))
        estimated_tokens = math.ceil(output_length / 4)
        return (estimated_tokens / 1000) * self._rate(model_name)

    def estimate_tokens(self, tool_call_output_length: int | str) -> int:
        output_length = len(tool_call_output_length) if isinstance(tool_call_output_length, str) else max(0, int(tool_call_output_length))
        return math.ceil(output_length / 4)

    def aggregate_cost(self, session_id: str, start_time: datetime | str, end_time: datetime | str) -> float:
        if self.supabase_client is None:
            raise RuntimeError("aggregate_cost requires a Supabase client")
        database_session_id = schema_uuid(session_id, "session")
        response = (self.supabase_client.table("tool_execution_logs")
                    .select("cost_incurred")
                    .eq("session_id", database_session_id)
                    .gte("executed_at", _iso(start_time))
                    .lte("executed_at", _iso(end_time))
                    .limit(10000)
                    .execute())
        return round(sum(float(row.get("cost_incurred") or 0) for row in (response.get("data") or [])), 8)


def _iso(value: datetime | str) -> str:
    return value.isoformat() if isinstance(value, datetime) else value
