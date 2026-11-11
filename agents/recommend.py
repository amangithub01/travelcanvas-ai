from state import TravelState


def recommend_hotels_node(state: TravelState):
    candidates = {item["id"]: item for item in state.get("hotel_candidates", [])}
    return {"hotel_candidates": sorted(candidates.values(), key=lambda item: (item.get("price") is None, item.get("price") or 0))}


def recommend_flights_node(state: TravelState):
    candidates = {item["id"]: item for item in state.get("flight_candidates", [])}
    return {"flight_candidates": sorted(candidates.values(), key=lambda item: (item.get("price") is None, item.get("price") or 0))}
