import logging
import time
from contextlib import asynccontextmanager
from threading import BoundedSemaphore
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from graph import app as travel_graph
from planning import TripRequest, build_plan
from staging import ControlError, Settings, authenticated_subject, get_controls

settings = Settings.from_env()
request_logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app):
    controls = get_controls()
    if controls.settings.mode == "staging":
        controls.ready()
    yield


app = FastAPI(title="AI Travel Planner API", version="0.4.0", lifespan=lifespan)
_planning_slots = BoundedSemaphore(2)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Retry-After", "X-Request-ID"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    request_id = str(uuid4())
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    if request.url.path not in ("/health", "/ready"):
        route = getattr(request.scope.get("route"), "path", "unmatched")
        request_logger.info("request method=%s route=%s status=%s duration_ms=%d request_id=%s",
                            request.method, route, response.status_code,
                            int((time.monotonic() - started) * 1000), request_id)
    return response


def control_http_error(error):
    headers = {"Retry-After": str(error.retry_after)}
    if error.status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return HTTPException(status_code=error.status, detail=str(error), headers=headers)


def planner_identity(authorization: str | None = Header(default=None)):
    try:
        return authenticated_subject(authorization)
    except ControlError as error:
        raise control_http_error(error) from None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready():
    try:
        return get_controls().ready()
    except ControlError as error:
        raise control_http_error(error) from None


@app.post("/plan-trip")
def plan_trip(request: TripRequest, subject=Depends(planner_identity)):
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
        with get_controls().plan(subject):
            final_state = travel_graph.invoke(initial_state)
            if final_state.get("error"):
                raise HTTPException(status_code=422, detail=final_state["error"])
            plan = build_plan(final_state)
    except ControlError as error:
        raise control_http_error(error) from None
    except HTTPException:
        raise
    except Exception:
        logging.error("Planning failed; internal exception details suppressed.")
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
