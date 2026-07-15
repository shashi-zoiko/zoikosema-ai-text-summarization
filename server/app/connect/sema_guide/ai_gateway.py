import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class GatewayDecision:
    allowed: bool
    reason: str | None = None
    cost_ceiling: int | None = None
    rate_remaining: int | None = None


class AIGateway:
    def __init__(self):
        self._rate_buckets: dict[str, list[float]] = {}

    def check_request(
        self,
        user_id: int,
        tenant_id: int | None = None,
        feature: str = "sema_guide_chat",
        plan: str = "free",
    ) -> GatewayDecision:
        now = time.time()

        plan_limits = {
            "free": {"requests_per_minute": 10, "max_tokens": 2048},
            "pro": {"requests_per_minute": 60, "max_tokens": 4096},
            "business": {"requests_per_minute": 120, "max_tokens": 8192},
            "enterprise": {"requests_per_minute": 300, "max_tokens": 16384},
        }
        limits = plan_limits.get(plan, plan_limits["free"])

        bucket_key = f"{user_id}:{feature}"
        bucket = self._rate_buckets.setdefault(bucket_key, [])
        cutoff = now - 60
        bucket[:] = [t for t in bucket if t > cutoff]

        if len(bucket) >= limits["requests_per_minute"]:
            return GatewayDecision(
                allowed=False,
                reason=f"Rate limit exceeded ({limits['requests_per_minute']}/minute for {plan} plan)",
                rate_remaining=0,
            )

        bucket.append(now)
        remaining = limits["requests_per_minute"] - len(bucket)

        return GatewayDecision(
            allowed=True,
            rate_remaining=remaining,
            cost_ceiling=limits["max_tokens"],
        )


gateway = AIGateway()
