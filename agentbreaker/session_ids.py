from __future__ import annotations

from uuid import NAMESPACE_URL, UUID, uuid5


def canonical_uuid(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(UUID(str(value).strip()))
    except (AttributeError, TypeError, ValueError):
        return None


def schema_uuid(value: str, entity: str) -> str:
    """Keep UUID inputs intact and map legacy string keys to stable schema UUIDs."""
    raw = str(value).strip()
    if not raw:
        raise ValueError(f"{entity} identifier must not be empty")
    return canonical_uuid(raw) or str(uuid5(NAMESPACE_URL, f"sovereignhalt:{entity}:{raw}"))
