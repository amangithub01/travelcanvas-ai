from search_cache import read_cache
from state import TravelState


def cache_node(state: TravelState):
    hotels, flights = read_cache(state, "hotels"), read_cache(state, "flights")
    result = {"hotels_cached": hotels is not None, "flights_cached": flights is not None, "cached_results": hotels is not None and flights is not None}
    if hotels is not None:
        result["hotel_candidates"] = hotels
    if flights is not None:
        result["flight_candidates"] = flights
    if hotels is not None or flights is not None:
        result["warnings"] = ["Some quotes were retrieved from a short-lived cache. Check each source timestamp and refresh with the provider before booking."]
    return result
