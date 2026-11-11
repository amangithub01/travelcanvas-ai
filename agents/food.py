import os
from planning import destination_location
from providers import ProviderUnavailable, local_places
from search_cache import read_cache, write_cache
from state import TravelState


def food_node(state: TravelState):
    cached = read_cache(state, "restaurants")
    if cached is not None:
        return {"food_recommendations": cached, "warnings": ["Restaurant results were reused from a destination cache. Check the original source timestamps."]}
    key = os.getenv("SERPAPI_API_KEY")
    if not key:
        return {"food_recommendations": [], "warnings": ["Restaurant search unavailable: SerpAPI is not configured."]}
    city = destination_location(state["destination"])
    try:
        places = local_places(city, "local restaurants", 6)
        write_cache(state, "restaurants", places)
        return {"food_recommendations": places, "warnings": [] if places else ["No restaurants were returned for this destination."]}
    except ProviderUnavailable as error:
        return {"food_recommendations": [], "warnings": [f"Restaurant search failed. {error} Add your own meal stops."]}
    except (TypeError, AttributeError):
        return {"food_recommendations": [], "warnings": ["Restaurant search failed. Add your own meal stops."]}
