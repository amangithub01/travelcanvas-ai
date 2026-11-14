from operator import add
from typing import Annotated, TypedDict


class TravelState(TypedDict, total=False):
    origin: str
    destination: str
    start_date: str
    end_date: str
    max_price: float
    currency: str
    adults: int
    pace: str
    interests: list[str]
    bedrooms: int
    min_rating: float
    cached_results: bool
    hotels_cached: bool
    flights_cached: bool
    error: str | None
    warnings: Annotated[list[str], add]
    weather_summary: str
    weather_source: dict
    hotel_candidates: list[dict]
    flight_candidates: list[dict]
    food_recommendations: list[dict]
    attraction_candidates: list[dict]
    day_place_ids: dict
    final_itinerary: str
    exchange: dict
    exchange_source: dict
