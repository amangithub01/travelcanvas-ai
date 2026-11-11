import json
import math
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone

from planning import DESTINATION_CURRENCIES, source
from providers import ProviderUnavailable, get_json
from search_cache import connect
from state import TravelState


def valid_rate(data, base, quote):
    if not isinstance(data, dict) or data.get("base") != base or data.get("quote") != quote:
        return False
    rate = data.get("rate")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0 < rate <= 1_000_000:
        return False
    try:
        as_of = date.fromisoformat(data["date"])
        today = datetime.now(timezone.utc).date()
        return today - timedelta(days=7) <= as_of <= today
    except (KeyError, TypeError, ValueError):
        return False


def exchange_node(state: TravelState):
    base = state.get("currency", "USD")
    quote = DESTINATION_CURRENCIES[state["destination"]]
    exchange = {"base": base, "quote": quote, "rate": None, "as_of": None, "source_id": None}
    if base == quote:
        return {"exchange": {**exchange, "rate": 1}}
    key = f"exchange:v1:{base}:{quote}"
    try:
        with connect() as conn:
            row = conn.execute("SELECT payload FROM search_cache_v1 WHERE cache_key = ? AND expires_at > ?", (key, time.time())).fetchone()
        if row:
            cached = json.loads(row[0])
            evidence = cached.get("source") if isinstance(cached, dict) else None
            if valid_rate(cached, base, quote) and isinstance(evidence, dict) and evidence.get("id") and evidence.get("retrieved_at") and evidence.get("kind") == "exchange_rate":
                return {"exchange": {**exchange, "rate": cached["rate"], "as_of": cached["date"], "source_id": evidence["id"]}, "exchange_source": evidence}
    except (sqlite3.Error, ValueError, TypeError, KeyError):
        pass
    try:
        url = f"https://api.frankfurter.dev/v2/rate/{base.lower()}/{quote.lower()}"
        data = get_json(url)
        if not valid_rate(data, base, quote):
            raise ProviderUnavailable("Exchange-rate data was invalid or older than seven days.")
        evidence = source("Frankfurter reference rates", "https://frankfurter.dev/", f"{base}:{quote}:{data['date']}", "exchange_rate")
        try:
            with connect() as conn:
                conn.execute("INSERT OR REPLACE INTO search_cache_v1 VALUES (?, ?, ?)", (key, time.time() + 21600, json.dumps({**data, "source": evidence}, allow_nan=False)))
        except (sqlite3.Error, ValueError, TypeError):
            pass
        return {"exchange": {**exchange, "rate": data["rate"], "as_of": data["date"], "source_id": evidence["id"]}, "exchange_source": evidence}
    except ProviderUnavailable:
        return {"exchange": exchange, "warnings": ["Destination currency conversion is unavailable. Budget figures remain in your selected currency; no exchange rate was invented."]}
