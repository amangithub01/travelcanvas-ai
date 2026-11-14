import json
import os
import sqlite3
import time
from contextlib import contextmanager


def cache_key(state, kind):
    if kind == "attractions":
        return json.dumps([2, kind, state["destination"], "google_local", sorted(state.get("interests", []))])
    if kind == "restaurants":
        return json.dumps([1, kind, state["destination"], "google_local"])
    return json.dumps([2, kind, state["origin"], state["destination"], state["start_date"], state["end_date"], state.get("currency", "USD"), state.get("adults", 1), 1])


@contextmanager
def connect():
    conn = sqlite3.connect(os.getenv("TRAVEL_CACHE_PATH", "travel_cache.db"), timeout=2)
    try:
        with conn:
            conn.execute("CREATE TABLE IF NOT EXISTS search_cache_v1 (cache_key TEXT PRIMARY KEY, expires_at REAL NOT NULL, payload TEXT NOT NULL)")
            yield conn
    finally:
        conn.close()


def read_cache(state, kind):
    try:
        with connect() as conn:
            row = conn.execute("SELECT payload FROM search_cache_v1 WHERE cache_key = ? AND expires_at > ?", (cache_key(state, kind), time.time())).fetchone()
        if row:
            items = json.loads(row[0])
            if isinstance(items, list) and items and all(isinstance(item, dict) and item.get("id") and item.get("source", {}).get("retrieved_at") for item in items):
                return items
    except (sqlite3.Error, ValueError, TypeError, AttributeError):
        pass
    return None


def write_cache(state, kind, items):
    if not items:
        return
    ttl = {"flights": 900, "hotels": 3600, "restaurants": 21600, "attractions": 21600}[kind]
    try:
        with connect() as conn:
            conn.execute("INSERT OR REPLACE INTO search_cache_v1 VALUES (?, ?, ?)", (cache_key(state, kind), time.time() + ttl, json.dumps(items, allow_nan=False)))
    except (sqlite3.Error, ValueError, TypeError):
        pass
