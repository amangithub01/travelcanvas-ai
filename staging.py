import hashlib
import logging
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from functools import lru_cache
from threading import Event, Thread
from urllib.parse import urlparse
from uuid import UUID, uuid4

import redis
import requests
from redis.backoff import NoBackoff
from redis.retry import Retry


class ControlError(Exception):
    def __init__(self, message, status=503, retry_after=5):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


def positive_int(name, default):
    try:
        value = int(os.getenv(name, str(default)))
        if not 1 <= value <= 1_000_000:
            raise ValueError
        return value
    except ValueError:
        raise ValueError(f"{name} must be an integer from 1 to 1000000.") from None


@dataclass(frozen=True)
class Settings:
    mode: str
    origins: tuple[str, ...]
    redis_url: str
    supabase_url: str
    publishable_key: str
    prefix: str
    max_active: int
    ingress_per_minute: int
    user_per_minute: int
    user_per_day: int
    plans_per_day: int
    provider_limits: dict

    @classmethod
    def from_env(cls):
        mode = os.getenv("RUN_MODE", "local")
        if mode not in ("local", "staging"):
            raise ValueError("RUN_MODE must be local or staging.")
        origins = tuple(value.strip() for value in os.getenv(
            "FRONTEND_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000" if mode == "local" else "",
        ).split(",") if value.strip())
        supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
        redis_url = os.getenv("REDIS_URL", "")
        prefix = os.getenv("REDIS_KEY_PREFIX", "travel-staging")
        if not re.fullmatch(r"[a-zA-Z0-9:_-]{1,60}", prefix):
            raise ValueError("REDIS_KEY_PREFIX must contain 1 to 60 letters, digits, colons, underscores or hyphens.")
        if mode == "staging":
            auth_url = urlparse(supabase_url)
            if (auth_url.scheme != "https" or not auth_url.hostname or auth_url.username
                    or auth_url.password or auth_url.path or auth_url.query or auth_url.fragment):
                raise ValueError("Staging requires SUPABASE_URL to be an HTTPS origin.")
            if not publishable_key.startswith("sb_publishable_"):
                raise ValueError("Staging requires SUPABASE_PUBLISHABLE_KEY, not a secret/service-role key.")
            if urlparse(redis_url).scheme not in ("redis", "rediss", "unix"):
                raise ValueError("Staging requires REDIS_URL.")
            if not origins or any(
                (urlparse(origin).scheme != "https" and not (
                    urlparse(origin).scheme == "http" and urlparse(origin).hostname in ("localhost", "127.0.0.1")
                )) or not urlparse(origin).hostname or urlparse(origin).path
                or urlparse(origin).username or urlparse(origin).password
                or urlparse(origin).query or urlparse(origin).fragment
                for origin in origins
            ):
                raise ValueError("Staging requires explicit HTTPS FRONTEND_ORIGINS (HTTP is allowed only for localhost).")
        return cls(
            mode, origins, redis_url, supabase_url, publishable_key, prefix,
            positive_int("MAX_ACTIVE_PLANS", 2),
            positive_int("INGRESS_PER_MINUTE", 60),
            positive_int("USER_PLANS_PER_MINUTE", 2),
            positive_int("USER_PLANS_PER_DAY", 10),
            positive_int("GLOBAL_PLANS_PER_DAY", 50),
            {name: positive_int(f"{name.upper()}_DAILY_REQUEST_LIMIT", limit) for name, limit in {
                "serpapi": 200, "groq": 50, "ollama": 50, "weather": 200, "exchange": 100, "foursquare": 50,
            }.items()},
        )


COUNTER_SCRIPT = """
if redis.call('EXISTS', KEYS[2]) == 1 then return {-1, 5} end
local now = tonumber(redis.call('TIME')[1])
local window = tonumber(ARGV[2])
local remaining = window - (now % window)
local key = KEYS[1] .. ':' .. math.floor(now / window)
if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[1]) then
  return {0, remaining}
end
if redis.call('INCR', key) == 1 then redis.call('EXPIRE', key, remaining + 1) end
return {1, remaining}
"""

PLAN_SCRIPT = """
if redis.call('EXISTS', KEYS[5]) == 1 then return {-1, 5} end
local time = redis.call('TIME')
local now = tonumber(time[1])
local millis = now * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', millis)
local windows = {60, 86400, 86400}
local limits = {tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])}
local counters = {}
for i = 1, 3 do
  counters[i] = KEYS[i + 1] .. ':' .. math.floor(now / windows[i])
  if tonumber(redis.call('GET', counters[i]) or '0') >= limits[i] then
    return {0, windows[i] - (now % windows[i])}
  end
end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return {2, 5} end
for i = 1, 3 do
  if redis.call('INCR', counters[i]) == 1 then
    redis.call('EXPIRE', counters[i], windows[i] - (now % windows[i]) + 1)
  end
end
redis.call('ZADD', KEYS[1], millis + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
return {1, 0}
"""

RENEW_SCRIPT = """
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expiry = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expiry or tonumber(expiry) <= now then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1
"""


class Controls:
    lease_ms = 180_000

    def __init__(self, settings, client=None):
        self.settings = settings
        self.client = client
        if settings.mode == "staging" and client is None:
            try:
                self.client = redis.Redis.from_url(
                    settings.redis_url, decode_responses=True,
                    socket_connect_timeout=1, socket_timeout=1,
                    retry=Retry(NoBackoff(), 0), max_connections=32,
                )
            except (ValueError, redis.RedisError):
                raise ValueError("Redis configuration is invalid.") from None

    def key(self, suffix):
        return f"{self.settings.prefix}:{suffix}"

    def execute(self, script, keys, args):
        try:
            return self.client.eval(script, len(keys), *keys, *args)
        except redis.RedisError:
            raise ControlError("Shared staging controls are unavailable. Try again later.") from None

    def counter(self, suffix, limit, window):
        result, retry = self.execute(COUNTER_SCRIPT, [self.key(suffix), self.key("paused")], [limit, window])
        if result == -1:
            raise ControlError("Planning is paused by the staging operator.")
        if result == 0:
            raise ControlError("The staging request allowance has been reached. Try again after the reset.", 429, int(retry))

    def ingress(self):
        if self.settings.mode == "staging":
            self.counter("ingress", self.settings.ingress_per_minute, 60)

    def provider(self, provider):
        if self.settings.mode == "staging":
            if provider not in self.settings.provider_limits:
                raise ControlError("This provider is not permitted by staging controls.")
            self.counter(f"provider:{provider}", self.settings.provider_limits[provider], 86400)

    @contextmanager
    def plan(self, subject):
        if self.settings.mode != "staging":
            yield
            return
        if not subject:
            raise ControlError("Sign in before generating a staging plan.", 401)
        user = hashlib.sha256(subject.encode()).hexdigest()
        token = str(uuid4())
        slots = self.key("active-plans")
        result, retry = self.execute(PLAN_SCRIPT, [
            slots, self.key(f"user:{user}:minute"), self.key(f"user:{user}:day"),
            self.key("plans:day"), self.key("paused"),
        ], [token, self.settings.max_active, self.lease_ms, self.settings.user_per_minute,
            self.settings.user_per_day, self.settings.plans_per_day])
        if result != 1:
            if result == -1:
                raise ControlError("Planning is paused by the staging operator.")
            message = "The shared planner is busy. Try again shortly." if result == 2 else "Your staging planning allowance has been reached. Try again after the reset."
            raise ControlError(message, 429, int(retry))
        stop, lost = Event(), Event()

        def renew():
            while not stop.wait(self.lease_ms / 3000):
                try:
                    if self.execute(RENEW_SCRIPT, [slots], [token, self.lease_ms]) != 1:
                        lost.set()
                        return
                except ControlError:
                    lost.set()
                    return

        thread = Thread(target=renew, name="planning-lease", daemon=True)
        thread.start()
        try:
            yield
            if lost.is_set() or self.execute(RENEW_SCRIPT, [slots], [token, self.lease_ms]) != 1:
                raise ControlError("The planning capacity lease was lost. Your saved trips are unaffected.")
        finally:
            stop.set()
            thread.join(timeout=2)
            try:
                self.client.zrem(slots, token)
            except redis.RedisError:
                logging.warning("Planning lease cleanup unavailable; lease will expire.")

    def ready(self):
        if self.settings.mode == "staging":
            try:
                if not self.client.ping():
                    raise redis.ConnectionError()
            except redis.RedisError:
                raise ControlError("Shared staging controls are unavailable.") from None
            if not os.getenv("SERPAPI_API_KEY"):
                raise ControlError("Required planning credentials are not configured.")
        return {"status": "ready", "mode": self.settings.mode, "live_providers_verified": False}


@lru_cache(maxsize=1)
def get_controls():
    return Controls(Settings.from_env())


def reserve_provider(provider):
    get_controls().provider(provider)


def authenticated_subject(authorization):
    controls = get_controls()
    if controls.settings.mode == "local":
        return None
    controls.ingress()
    parts = authorization.split() if isinstance(authorization, str) else []
    if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) > 16384:
        raise ControlError("Sign in before generating a staging plan.", 401)
    try:
        response = requests.get(
            f"{controls.settings.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {parts[1]}", "apikey": controls.settings.publishable_key},
            timeout=(3, 5), allow_redirects=False,
        )
        if response.status_code in (401, 403):
            raise ControlError("Your sign-in has expired or is invalid. Sign in again.", 401)
        if response.status_code != 200:
            raise ControlError("Account verification is temporarily unavailable.")
        user = response.json()
        if (not isinstance(user, dict) or user.get("role") != "authenticated"
                or user.get("is_anonymous") is True or not user.get("email_confirmed_at")):
            raise ControlError("Use a confirmed email account before generating a staging plan.", 401)
        return str(UUID(user["id"]))
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raise ControlError("Account verification is temporarily unavailable.") from None
