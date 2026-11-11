import os
from urllib.parse import urlencode

from planning import AIRPORTS, destination_location, price_or_none, safe_url, source
from providers import ProviderUnavailable, get_json
from state import TravelState


def get_city_from_code(airport_code: str) -> str:
    return AIRPORTS[airport_code][0]


def search_node(state: TravelState):
    if state.get("hotels_cached"):
        return {}
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        return {"hotel_candidates": [], "warnings": ["Hotel search unavailable: SerpAPI is not configured."]}
    city = get_city_from_code(state["destination"])
    params = {
        "engine": "google_hotels", "q": destination_location(state["destination"]), "check_in_date": state["start_date"],
        "check_out_date": state["end_date"], "currency": state.get("currency", "USD"), "hl": "en",
        "adults": state.get("adults", 1), "api_key": api_key,
    }
    try:
        data = get_json("https://serpapi.com/search", params=params)
        hotels = []
        for hotel in data.get("properties", [])[:6]:
            if not isinstance(hotel, dict) or not hotel.get("name"):
                continue
            url = safe_url(hotel.get("link")) or "https://www.google.com/travel/search?" + urlencode({"q": f"{hotel['name']} {city}"})
            currency, adults = state.get("currency", "USD"), state.get("adults", 1)
            evidence = source("Google Hotels via SerpAPI", url, f"{state['destination']}:{hotel['name']}:{state['start_date']}:{state['end_date']}:{currency}:{adults}", "quote")
            rating = hotel.get("overall_rating")
            hotels.append({
                "id": evidence["id"], "name": hotel["name"],
                "price": price_or_none((hotel.get("rate_per_night") or {}).get("extracted_lowest")),
                "currency": currency,
                "price_basis": f"Per night, one shared room; search for {adults} adult(s). Confirm occupancy and taxes",
                "rating": rating if isinstance(rating, (int, float)) and 0 <= rating <= 5 else None,
                "source": evidence,
            })
        return {"hotel_candidates": hotels, "warnings": [] if hotels else ["No hotel quotes were returned for these dates."]}
    except ProviderUnavailable as error:
        return {"hotel_candidates": [], "warnings": [f"Hotel search failed. {error} Other parts of your draft remain available."]}
    except (TypeError, AttributeError):
        return {"hotel_candidates": [], "warnings": ["Hotel search failed. Other parts of your draft remain available."]}
