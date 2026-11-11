from langgraph.graph import StateGraph, START, END
from state import TravelState

from agents.weather import weather_node
from agents.database_agent import cache_node
from agents.search import search_node
from agents.flight import flight_node
from agents.store import store_node
from agents.recommend import recommend_hotels_node, recommend_flights_node
from agents.itinerary import itinerary_node
from agents.food import food_node
from agents.attractions import attractions_node
from agents.budget import budget_node
from agents.exchange import exchange_node

workflow = StateGraph(TravelState)

workflow.add_node("weather_agent", weather_node)
workflow.add_node("cache_agent", cache_node)
workflow.add_node("search_agent", search_node)
workflow.add_node("flight_agent", flight_node)
workflow.add_node("store_agent", store_node)
workflow.add_node("recommend_hotels", recommend_hotels_node)
workflow.add_node("recommend_flights", recommend_flights_node)
workflow.add_node("food_agent", food_node)
workflow.add_node("attractions_agent", attractions_node)
workflow.add_node("itinerary_agent", itinerary_node)
workflow.add_node("budget_agent", budget_node)
workflow.add_node("exchange_agent", exchange_node)


# 3. The Smart Router (Conditional Logic)
def route_after_budget(state: TravelState):
    """Stop validation errors before making provider requests."""
    if state.get("error"):
        return END
    else:
        return "cache_agent"


workflow.add_edge(START, "budget_agent")
workflow.add_conditional_edges("budget_agent", route_after_budget)
search_nodes = ["weather_agent", "search_agent", "flight_agent", "food_agent", "attractions_agent", "exchange_agent"]
for node in search_nodes:
    workflow.add_edge("cache_agent", node)
# Wait for every search before selecting quotes or organizing the itinerary.
workflow.add_edge(search_nodes, "store_agent")
workflow.add_edge("store_agent", "recommend_hotels")
workflow.add_edge("recommend_hotels", "recommend_flights")
workflow.add_edge("recommend_flights", "itinerary_agent")
workflow.add_edge("itinerary_agent", END)

app = workflow.compile()
