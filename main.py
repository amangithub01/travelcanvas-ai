import logging
import os
from threading import BoundedSemaphore

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from graph import app as travel_graph
from planning import TripRequest, build_plan

app = FastAPI(title="AI Travel Planner API", version="0.3.0")
_planning_slots = BoundedSemaphore(2)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/plan-trip")
def plan_trip(request: TripRequest):
    if not _planning_slots.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="The planner is busy. Wait a few seconds and try again; your saved trips are unaffected.",
            headers={"Retry-After": "5"},
        )
    initial_state = {
        **request.model_dump(mode="json"), "min_rating": 0,
        "warnings": [], "hotel_candidates": [], "flight_candidates": [],
        "food_recommendations": [], "attraction_candidates": [],
    }
    try:
        final_state = travel_graph.invoke(initial_state)
        if final_state.get("error"):
            raise HTTPException(status_code=422, detail=final_state["error"])
        plan = build_plan(final_state)
    except HTTPException:
        raise
    except Exception:
        logging.exception("Planning failed")
        raise HTTPException(status_code=503, detail="Planning is temporarily unavailable. Your saved trips are unaffected.") from None
    finally:
        _planning_slots.release()
    itinerary = "\n\n".join(f"### Day {index + 1}\n{day['date']}\n" + "\n".join(activity["title"] for activity in day["activities"]) for index, day in enumerate(plan["days"]))
    return {
        "status": "partial" if final_state.get("warnings") else "success",
        "plan": plan, "weather": plan["weather"]["summary"], "itinerary": itinerary,
        "flights": [{**item, "airline": item["name"]} for item in plan["flights"]],
        "hotels": plan["hotels"], "food": final_state.get("food_recommendations", []),
        "attractions": final_state.get("attraction_candidates", []),
    }
