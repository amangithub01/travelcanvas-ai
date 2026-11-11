import os

from planning import destination_location, source
from providers import ProviderUnavailable, get_json, local_places
from search_cache import read_cache, write_cache
from state import TravelState


def attractions_node(state: TravelState):
    city = destination_location(state["destination"])
    if os.getenv("SERPAPI_API_KEY"):
        cached = read_cache(state, "attractions")
        if cached is not None:
            return {"attraction_candidates": cached, "warnings": ["Attraction results were reused from a destination cache. Check the original source timestamps."]}
        try:
            places = local_places(city, "tourist attractions and landmarks", 9)
            write_cache(state, "attractions", places)
            return {"attraction_candidates": places, "warnings": [] if places else ["No attractions were returned for this destination."]}
        except ProviderUnavailable as error:
            return {"attraction_candidates": [], "warnings": [f"Attraction search through SerpAPI failed. {error} Add your own places meanwhile."]}
        except (TypeError, AttributeError):
            return {"attraction_candidates": [], "warnings": ["Attraction search returned unsupported data. Add your own places meanwhile."]}
    key = os.getenv("FOURSQUARE_API_KEY")
    if not key:
        return {"attraction_candidates": [], "warnings": ["Attraction search unavailable: configure SerpAPI (recommended) or optional Foursquare."]}
    try:
        data = get_json("https://api.foursquare.com/v3/places/search", params={"near": city, "categories": "10000", "limit": 9}, headers={"accept": "application/json", "Authorization": key})
        places = []
        for place in data.get("results", []):
            if not place.get("name") or not place.get("fsq_id"):
                continue
            evidence = source("Foursquare", f"https://foursquare.com/v/{place['fsq_id']}", place["fsq_id"])
            places.append({"id": evidence["id"], "name": place["name"], "address": (place.get("location") or {}).get("formatted_address") or "", "source": evidence})
        return {"attraction_candidates": places, "warnings": [] if places else ["No attractions were returned for this destination."]}
    except (ProviderUnavailable, TypeError, AttributeError):
        return {"attraction_candidates": [], "warnings": ["Attraction search failed. Add your own places to the draft."]}
