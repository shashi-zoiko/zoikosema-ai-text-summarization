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
            "free": {"requests_per_minute": 30, "max_tokens": 2048, "per_day": 500},
            "pro": {"requests_per_minute": 120, "max_tokens": 4096, "per_day": 2000},
            "business": {"requests_per_minute": 300, "max_tokens": 4096, "per_day": 5000},
            "enterprise": {"requests_per_minute": 600, "max_tokens": 8192, "per_day": 20000},
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

        daily_key = f"{user_id}:{feature}:daily"
        daily_bucket = self._rate_buckets.setdefault(daily_key, [])
        day_cutoff = now - 86400
        daily_bucket[:] = [t for t in daily_bucket if t > day_cutoff]

        if len(daily_bucket) >= limits.get("per_day", 999999):
            return GatewayDecision(
                allowed=False,
                reason=f"Daily rate limit exceeded ({limits['per_day']}/day for {plan} plan)",
                rate_remaining=0,
            )

        bucket.append(now)
        daily_bucket.append(now)
        remaining = limits["requests_per_minute"] - len(bucket)

        return GatewayDecision(
            allowed=True,
            rate_remaining=remaining,
            cost_ceiling=limits["max_tokens"],
        )


gateway = AIGateway()
