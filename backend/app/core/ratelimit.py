"""Fixed-window rate limiter backed by Redis, with an in-process fallback (tests / Redis outage)."""

from __future__ import annotations

import logging
import threading
import time

from app.core.config import get_settings

log = logging.getLogger(__name__)


class RateLimiter:
    def __init__(self) -> None:
        self._mem: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()
        self._redis = None
        self._redis_failed_at = 0.0

    def _client(self):  # noqa: ANN202
        if get_settings().environment == "test":
            return None
        if self._redis is None and time.monotonic() - self._redis_failed_at > 30:
            try:
                import redis

                self._redis = redis.Redis.from_url(get_settings().redis_url, socket_timeout=1)
                self._redis.ping()
            except Exception:  # noqa: BLE001
                log.warning("Rate limiter: Redis unavailable, using in-process fallback")
                self._redis = None
                self._redis_failed_at = time.monotonic()
        return self._redis

    def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Record a hit; return True if allowed, False if the limit is exceeded."""
        bucket = int(time.time() // window_seconds)
        full_key = f"rl:{key}:{bucket}"
        client = self._client()
        if client is not None:
            try:
                pipe = client.pipeline()
                pipe.incr(full_key)
                pipe.expire(full_key, window_seconds + 5)
                count, _ = pipe.execute()
                return int(count) <= limit
            except Exception:  # noqa: BLE001
                self._redis = None
                self._redis_failed_at = time.monotonic()
        with self._lock:
            count, exp = self._mem.get(full_key, (0, time.time() + window_seconds))
            if exp < time.time():
                count = 0
            count += 1
            self._mem[full_key] = (count, exp)
            if len(self._mem) > 10000:
                now = time.time()
                self._mem = {k: v for k, v in self._mem.items() if v[1] > now}
            return count <= limit

    def reset(self) -> None:
        with self._lock:
            self._mem.clear()


limiter = RateLimiter()
