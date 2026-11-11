import os
from urllib.parse import urlencode

from planning import price_or_none, source
from providers import ProviderUnavailable, get_json
from state import TravelState


def flight_node(state: TravelState):
    if state.get("flights_cached"):
        return {}
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return {"flight_candidates": [], "warnings": ["Flight search unavailable: SerpAPI is not configured."]}
    params = {
        "engine": "google_flights", "departure_id": state["origin"], "arrival_id": state["destination"],
        "outbound_date": state["start_date"], "return_date": state["end_date"],
        "currency": state.get("currency", "USD"), "hl": "en", "adults": state.get("adults", 1), "type": 1, "api_key": api_key,
    }
    try:
        data = get_json("https://serpapi.com/search", params=params)
        flights = []
        for index, option in enumerate((data.get("best_flights", []) + data.get("other_flights", []))[:6]):
            legs = option.get("flights") or []
            if not legs:
                continue
            url = "https://www.google.com/travel/flights?" + urlencode({"q": f"{state['origin']} to {state['destination']} {state['start_date']} return {state['end_date']}"})
            currency, adults = state.get("currency", "USD"), state.get("adults", 1)
            evidence = source("Google Flights via SerpAPI", url, f"{state['origin']}:{state['destination']}:{state['start_date']}:{state['end_date']}:{currency}:{adults}:{index}", "quote")
            flights.append({
                "id": evidence["id"], "name": legs[0].get("airline") or "Airline not supplied",
                "price": price_or_none(option.get("price")),
                "currency": currency,
                "price_basis": f"Returned round-trip quote for a {adults}-adult search; confirm final group fare with provider",
                "departure": (legs[0].get("departure_airport") or {}).get("time"),
                "arrival": (legs[-1].get("arrival_airport") or {}).get("time"),
                "source": evidence,
            })
        return {"flight_candidates": flights, "warnings": [] if flights else ["No flight quotes were returned for this route and dates."]}
    except ProviderUnavailable as error:
        return {"flight_candidates": [], "warnings": [f"Flight search failed. {error} Other parts of your draft remain available."]}
    except (TypeError, AttributeError):
        return {"flight_candidates": [], "warnings": ["Flight search failed. Other parts of your draft remain available."]}
