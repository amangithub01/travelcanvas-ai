import hashlib
import math
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


AIRPORTS = {
    "BOM": ("Mumbai", 19.0896, 72.8656),
    "DEL": ("Delhi", 28.5562, 77.1000),
    "HYD": ("Hyderabad", 17.2403, 78.4294),
    "BLR": ("Bengaluru", 13.1986, 77.7066),
    "MAA": ("Chennai", 12.9941, 80.1709),
    "CCU": ("Kolkata", 22.6547, 88.4467),
    "DXB": ("Dubai", 25.2532, 55.3657),
    "JFK": ("New York", 40.6413, -73.7781),
    "LHR": ("London", 51.4700, -0.4543),
    "CDG": ("Paris", 49.0097, 2.5479),
    "HND": ("Tokyo", 35.5494, 139.7798),
    "SIN": ("Singapore", 1.3644, 103.9915),
}

AIRPORT_COUNTRIES = {
    "BOM": "India", "DEL": "India", "HYD": "India", "BLR": "India",
    "MAA": "India", "CCU": "India", "DXB": "United Arab Emirates",
    "JFK": "United States", "LHR": "United Kingdom", "CDG": "France",
    "HND": "Japan", "SIN": "Singapore",
}
DESTINATION_CURRENCIES = {
    "BOM": "INR", "DEL": "INR", "HYD": "INR", "BLR": "INR",
    "MAA": "INR", "CCU": "INR", "DXB": "AED", "JFK": "USD",
    "LHR": "GBP", "CDG": "EUR", "HND": "JPY", "SIN": "SGD",
}
INTEREST_QUERIES = {
    "culture": "museums and historic landmarks",
    "nature": "parks and gardens",
    "food": "food markets and culinary attractions",
    "shopping": "shopping markets and shopping districts",
}
PACE_LIMITS = {"relaxed": 2, "balanced": 3, "packed": 4}


def activity_limit(state, day, count):
    return 1 if day in (1, count) else PACE_LIMITS[state.get("pace", "balanced")]


def attraction_query(state):
    interests = sorted(state.get("interests", []))
    return "tourist attractions and landmarks" if not interests else ", ".join(INTEREST_QUERIES[interest] for interest in interests)


def destination_location(code):
    return f"{AIRPORTS[code][0]}, {AIRPORT_COUNTRIES[code]}"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def money(value):
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def price_or_none(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return money(number) if math.isfinite(number) and 0 < number <= 100_000_000 else None
    except (ValueError, TypeError):
        return None


def safe_url(value):
    from urllib.parse import urlparse

    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return None
    except ValueError:
        return None
    return value


class TripRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    origin: str
    destination: str
    start_date: date
    end_date: date
    max_price: float = Field(gt=0, le=100_000_000, allow_inf_nan=False)
    currency: Literal["INR", "USD"] = "USD"
    adults: int = Field(default=1, ge=1, le=6, strict=True)
    pace: Literal["relaxed", "balanced", "packed"] = "balanced"
    interests: list[Literal["culture", "nature", "food", "shopping"]] = Field(default_factory=list, max_length=4)

    @field_validator("interests")
    @classmethod
    def unique_interests(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Choose each interest only once.")
        return sorted(value)

    @field_validator("origin", "destination")
    @classmethod
    def airport(cls, value):
        value = value.strip()
        match = re.search(r"\(([A-Za-z]{3})\)$", value)
        code = match[1].upper() if match else value.upper()
        if code not in AIRPORTS:
            code = next((key for key, airport in AIRPORTS.items() if airport[0].casefold() == value.casefold()), code)
        if code not in AIRPORTS:
            raise ValueError("Choose one of the 12 supported airports from the suggestions.")
        return code

    @model_validator(mode="after")
    def validate_trip(self):
        if self.currency == "USD" and self.max_price > 1_000_000:
            raise ValueError("USD budgets must not exceed 1,000,000.")
        if self.origin == self.destination:
            raise ValueError("Origin and destination must be different.")
        if self.start_date < datetime.now(timezone.utc).date():
            raise ValueError("Departure must be today or later (UTC).")
        nights = (self.end_date - self.start_date).days
        if not 1 <= nights <= 14:
            raise ValueError("Return must be 1 to 14 nights after departure for this alpha.")
        return self


def source(provider, url, key, kind="search"):
    return {
        "id": hashlib.sha256(f"{provider}:{key}".encode()).hexdigest()[:20],
        "provider": provider,
        "url": safe_url(url),
        "retrieved_at": now_iso(),
        "kind": kind,
    }


def budget_for(state, flight=None, hotel=None):
    nights = (date.fromisoformat(state["end_date"]) - date.fromisoformat(state["start_date"])).days
    currency, adults = state.get("currency", "USD"), state.get("adults", 1)
    lines = [
        {"category": "flights", "amount": flight.get("price") if flight else None, "basis": f"Round-trip search quote for {adults} adult(s); not multiplied again"},
        {"category": "stays", "amount": money(Decimal(str(hotel["price"])) * nights) if hotel and hotel.get("price") is not None else None, "basis": f"One shared room × {nights} nights; confirm occupancy for {adults} adult(s)"},
    ]
    for category in ("meals", "transport", "activities", "taxes", "contingency"):
        lines.append({"category": category, "amount": None, "basis": "Unknown; add your whole-trip estimate"})
    total = money(sum(Decimal(str(line["amount"])) for line in lines if line["amount"] is not None))
    return {
        "currency": currency, "limit": state["max_price"], "nights": nights,
        "lines": lines, "known_total": total,
        "unallocated": money(Decimal(str(state["max_price"])) - Decimal(str(total))),
        "is_complete": False,
        "over_budget": total > state["max_price"],
    }


def choose_quotes(state):
    flights = state.get("flight_candidates", [])
    hotels = state.get("hotel_candidates", [])
    priced_flights = [item for item in flights if item.get("price") is not None]
    priced_hotels = [item for item in hotels if item.get("price") is not None]
    flight = min(priced_flights, key=lambda item: item["price"], default=None)
    hotel = min(priced_hotels, key=lambda item: item["price"], default=None)
    return flight, hotel


def build_plan(state):
    flight, hotel = choose_quotes(state)
    start, end = date.fromisoformat(state["start_date"]), date.fromisoformat(state["end_date"])
    places = state.get("attraction_candidates", []) + state.get("food_recommendations", [])
    by_id = {place["id"]: place for place in places}
    assigned = set()
    days = []
    suggested = state.get("day_place_ids", {})
    for index in range((end - start).days + 1):
        day = {"id": str(uuid4()), "date": (start + timedelta(days=index)).isoformat(), "title": f"Day {index + 1}", "activities": []}
        ids = suggested.get(str(index + 1), [])
        for place_id in ids:
            if place_id not in by_id or place_id in assigned:
                continue
            if len(day["activities"]) >= activity_limit(state, index + 1, (end - start).days + 1):
                break
            place = by_id[place_id]
            assigned.add(place_id)
            day["activities"].append({
                "id": str(uuid4()), "title": place["name"],
                "notes": place.get("address") or "",
                "time": None, "duration_minutes": None,
                "source_id": place["source"]["id"], "origin": "provider",
            })
        days.append(day)
    quote_sources = [item["source"] for item in state.get("flight_candidates", []) + state.get("hotel_candidates", []) + places]
    if state.get("weather_source"):
        quote_sources.append(state["weather_source"])
    if state.get("exchange_source"):
        quote_sources.append(state["exchange_source"])
    sources = list({item["id"]: item for item in quote_sources}.values())
    warnings = list(dict.fromkeys(state.get("warnings", []) + [
        "Draft order only. Travel times and opening hours have not been verified. Check them before setting activity times.",
        "Keep arrival and departure days flexible until flight schedules are confirmed.",
        "Quotes are not bookings. Baggage, taxes, meals, transport, and activity costs may be excluded.",
        f"Budget covers {state.get('adults', 1)} adult(s), one shared room, {state.get('currency', 'USD')}, and a round-trip flight search. Confirm room occupancy and the final group fare.",
        f"{state.get('pace', 'balanced').capitalize()} pacing: up to {PACE_LIMITS[state.get('pace', 'balanced')]} stops on full days and one on arrival/departure days, including food stops. This is a count limit, not a verified time or walking-effort estimate.",
    ]))
    if state.get("interests"):
        warnings.append("Interests guide place searches and draft ordering, not verified category matches. Some interests may have no suitable results; no extra places are invented to fill days.")
    budget = budget_for(state, flight, hotel)
    if budget["over_budget"]:
        warnings.append("Even the lowest priced retrieved flight/stay combination exceeds your budget before other expenses.")
    if not places:
        warnings.append("No source-backed places were retrieved. Add your own activities; none have been invented.")
    stamp = now_iso()
    return {
        "version": 2, "id": str(uuid4()), "title": f"{AIRPORTS[state['destination']][0]} itinerary",
        "created_at": stamp, "updated_at": stamp,
        "request": {**{key: state[key] for key in ("origin", "destination", "start_date", "end_date", "max_price")}, "currency": state.get("currency", "USD"), "adults": state.get("adults", 1), "pace": state.get("pace", "balanced"), "interests": state.get("interests", [])},
        "days": days, "flights": state.get("flight_candidates", []), "hotels": state.get("hotel_candidates", []),
        "selected_flight_id": flight["id"] if flight else None,
        "selected_hotel_id": hotel["id"] if hotel else None,
        "estimates": {key: None for key in ("meals", "transport", "activities", "taxes", "contingency")},
        "weather": {"summary": state.get("weather_summary", "Weather unavailable."), "source_id": state.get("weather_source", {}).get("id"), "kind": "current" if state.get("weather_source") else "unavailable"},
        "exchange": state.get("exchange", {
            "base": state.get("currency", "USD"), "quote": DESTINATION_CURRENCIES[state["destination"]],
            "rate": 1 if state.get("currency", "USD") == DESTINATION_CURRENCIES[state["destination"]] else None,
            "as_of": None, "source_id": None,
        }),
        "sources": sources, "warnings": warnings, "budget": budget,
    }
