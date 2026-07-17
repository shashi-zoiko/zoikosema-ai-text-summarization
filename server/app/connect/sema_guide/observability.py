import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

log = logging.getLogger(__name__)


@dataclass
class RequestSpan:
    request_id: str
    tenant_id: int | None
    user_id: int
    feature: str
    started_at: float
    completed_at: float | None = None
    duration_ms: float | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_units: float | None = None
    success: bool = True
    error: str | None = None
    metadata: dict = field(default_factory=dict)


_spans: list[RequestSpan] = []
_MAX_SPANS = 10000


def record_span(span: RequestSpan) -> None:
    _spans.append(span)
    if len(_spans) > _MAX_SPANS:
        _spans.pop(0)


def get_stats(minutes: int = 60) -> dict:
    now = time.time()
    cutoff = now - (minutes * 60)
    recent = [s for s in _spans if s.started_at >= cutoff]

    total = len(recent)
    if total == 0:
        return {
            "total_requests": 0,
            "avg_duration_ms": 0,
            "p95_duration_ms": 0,
            "success_rate": 0,
            "total_tokens": 0,
            "feature_breakdown": {},
        }

    durations = sorted([s.duration_ms for s in recent if s.duration_ms is not None])
    successful = sum(1 for s in recent if s.success)
    total_tokens = sum((s.input_tokens or 0) + (s.output_tokens or 0) for s in recent)

    features = {}
    for s in recent:
        features.setdefault(s.feature, 0)
        features[s.feature] += 1

    p95_idx = int(len(durations) * 0.95)
    p95 = durations[p95_idx] if durations else 0

    return {
        "total_requests": total,
        "avg_duration_ms": round(sum(durations) / len(durations), 1) if durations else 0,
        "p95_duration_ms": round(p95, 1),
        "success_rate": round(successful / total * 100, 1),
        "total_tokens": total_tokens,
        "feature_breakdown": features,
    }
