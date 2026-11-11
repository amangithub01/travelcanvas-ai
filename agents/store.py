from search_cache import write_cache
from state import TravelState


def store_node(state: TravelState):
    if not state.get("hotels_cached"):
        write_cache(state, "hotels", state.get("hotel_candidates", []))
    if not state.get("flights_cached"):
        write_cache(state, "flights", state.get("flight_candidates", []))
    return {}
