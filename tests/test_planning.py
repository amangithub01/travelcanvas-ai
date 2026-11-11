import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from contextlib import closing
from threading import Barrier, Lock

import requests
from fastapi.testclient import TestClient

from agents.database_agent import cache_node
from agents.exchange import exchange_node
from agents.attractions import attractions_node
from agents.flight import flight_node
from agents.itinerary import DaySelection, ItinerarySelection, itinerary_node
from agents.food import food_node
from agents.search import search_node
from main import app
from planning import TripRequest, budget_for, build_plan
from providers import ProviderUnavailable, get_json
from search_cache import cache_key, read_cache, write_cache


def trip_request():
    start = datetime.now(timezone.utc).date() + timedelta(days=30)
    return {"origin": "BOM", "destination": "DEL", "start_date": start.isoformat(), "end_date": (start + timedelta(days=3)).isoformat(), "max_price": 500}


def provider_response(url, *, params=None, headers=None, timeout=None):
    data = {}
    if "open-meteo" in url:
        data = {"current_weather": {"temperature": 26, "windspeed": 12, "time": "2026-11-10T12:00"}}
    elif "frankfurter" in url:
        base, quote = url.rsplit("/", 2)[-2:]
        data = {"date": datetime.now(timezone.utc).date().isoformat(), "base": base.upper(), "quote": quote.upper(), "rate": 0.012 if base == "inr" else 83.3}
    elif "foursquare" in url:
        data = {"results": [
            {"fsq_id": f"place-{i}", "name": name, "location": {"formatted_address": "New Delhi, India"}}
            for i, name in enumerate(["Humayun's Tomb", "Lodhi Garden", "Qutub Minar", "Red Fort"])
        ]}
    elif params.get("engine") == "google_hotels":
        data = {"properties": [
            {"name": "Source-backed stay", "rate_per_night": {"extracted_lowest": 60.25}, "overall_rating": 4.5, "link": "https://example.com/hotel"},
            {"name": "Price not supplied", "rate_per_night": {}},
        ]}
    elif params.get("engine") == "google_flights":
        data = {"best_flights": [
            {"price": 142.1, "flights": [{"airline": "Source-backed airline", "departure_airport": {"time": "2026-12-10 06:15"}, "arrival_airport": {"time": "2026-12-10 08:30"}}]},
        ]}
    elif params.get("engine") == "google_local":
        if "attractions" in params.get("q", ""):
            data = {"local_results": [
                {"place_id": f"attraction-{i}", "title": name, "address": "New Delhi, India"}
                for i, name in enumerate(["Humayun's Tomb", "Lodhi Garden", "Qutub Minar", "Red Fort"])
            ]}
        else:
            data = {"local_results": [{"title": "Source-backed restaurant", "address": "Old Delhi", "website": "https://example.com/restaurant"}]}
    response = Mock()
    response.json.return_value = data
    response.raise_for_status.return_value = None
    return response


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache_path = str(Path(self.temp.name) / "cache.db")
        self.env = patch.dict(os.environ, {"TRAVEL_CACHE_PATH": self.cache_path, "SERPAPI_API_KEY": "test-key", "FOURSQUARE_API_KEY": "test-key", "GROQ_API_KEY": ""})
        self.env.start()
        self.client = TestClient(app)

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_request_validation_and_deterministic_city_lookup(self):
        request = trip_request()
        parsed = TripRequest(**{**request, "origin": "mumbai", "destination": "Delhi (DEL)"})
        self.assertEqual((parsed.origin, parsed.destination), ("BOM", "DEL"))
        for invalid in (
            {"origin": "XXX"}, {"destination": "BOM"}, {"max_price": 0},
            {"max_price": float("inf")}, {"start_date": "2020-01-01"},
            {"end_date": request["start_date"]},
            {"end_date": (datetime.fromisoformat(request["start_date"]) + timedelta(days=15)).date().isoformat()},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                TripRequest(**{**request, **invalid})

    def test_full_graph_sources_prices_and_no_append_duplicates(self):
        with patch("providers.requests.get", side_effect=provider_response) as network:
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 200, response.text)
        plan = response.json()["plan"]
        self.assertEqual(len(plan["flights"]), 1)
        self.assertEqual(len(plan["hotels"]), 2)
        self.assertIsNone(plan["hotels"][1]["price"])
        self.assertEqual(plan["budget"]["known_total"], 322.85)
        self.assertEqual(plan["budget"]["unallocated"], 177.15)
        self.assertFalse(plan["budget"]["is_complete"])
        self.assertEqual(len(plan["days"]), 4)
        self.assertLessEqual(len(plan["days"][0]["activities"]), 1)
        self.assertLessEqual(len(plan["days"][-1]["activities"]), 1)
        activities = [activity for day in plan["days"] for activity in day["activities"]]
        self.assertEqual(len(activities), 5)
        self.assertEqual(len({activity["source_id"] for activity in activities}), len(activities))
        self.assertTrue(all(activity["time"] is None for activity in activities))
        self.assertTrue(all(activity["source_id"] in {source["id"] for source in plan["sources"]} for activity in activities))
        self.assertIn("not a forecast", plan["weather"]["summary"])
        self.assertEqual(plan["flights"][0]["departure"], "2026-12-10 06:15")
        self.assertTrue(all(call.kwargs["timeout"] == (3, 10) for call in network.call_args_list))
        self.assertNotIn("test-key", response.text)

    def test_cheapest_combination_does_not_claim_over_budget_is_feasible(self):
        with patch("providers.requests.get", side_effect=provider_response):
            response = self.client.post("/plan-trip", json={**trip_request(), "max_price": 50})
        plan = response.json()["plan"]
        self.assertTrue(plan["budget"]["over_budget"])
        self.assertEqual(plan["budget"]["unallocated"], -272.85)
        self.assertTrue(any("exceeds" in warning for warning in plan["warnings"]))

    def test_missing_keys_produce_editable_partial_plan_not_fake_success(self):
        with patch.dict(os.environ, {"SERPAPI_API_KEY": "", "FOURSQUARE_API_KEY": ""}), patch("providers.requests.get", side_effect=requests.Timeout()):
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "partial")
        self.assertTrue(all(not day["activities"] for day in data["plan"]["days"]))
        self.assertTrue(all(line["amount"] is None for line in data["plan"]["budget"]["lines"]))
        self.assertIsNone(data["plan"]["selected_flight_id"])
        self.assertTrue(data["plan"]["warnings"])
        self.assertIsNone(data["plan"]["weather"]["source_id"])

    def test_provider_errors_remain_partial(self):
        bad = Mock()
        bad.raise_for_status.side_effect = requests.HTTPError("Provider failed")
        with patch("providers.requests.get", return_value=bad):
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "partial")
        with patch("providers.requests.get", return_value=Mock(json=lambda: {"error": "quota"})):
            with self.assertRaises(ProviderUnavailable):
                get_json("https://example.com")

    def test_cache_keys_cover_route_dates_and_preserve_legacy_data(self):
        request = trip_request()
        with closing(sqlite3.connect(self.cache_path)) as conn, conn:
            conn.execute("CREATE TABLE accommodations (name TEXT)")
            conn.execute("INSERT INTO accommodations VALUES ('Do not alter')")
        with patch("providers.requests.get", side_effect=provider_response):
            items = flight_node(request)["flight_candidates"]
        write_cache(request, "flights", items)
        self.assertEqual(read_cache(request, "flights"), items)
        for change in ({"origin": "BLR"}, {"start_date": "2030-01-01"}, {"end_date": "2030-01-06"}, {"destination": "DXB"}):
            self.assertIsNone(read_cache({**request, **change}, "flights"))
        self.assertFalse(cache_node(request)["cached_results"])
        self.assertTrue(cache_node(request)["flights_cached"])
        self.assertFalse(cache_node(request)["hotels_cached"])
        with closing(sqlite3.connect(self.cache_path)) as conn, conn:
            self.assertEqual(conn.execute("SELECT name FROM accommodations").fetchone()[0], "Do not alter")
            conn.execute("UPDATE search_cache_v1 SET expires_at = 0")
        self.assertIsNone(read_cache(request, "flights"))
        self.assertNotEqual(cache_key(request, "flights"), cache_key(request, "hotels"))

    def test_partial_cache_fetches_missing_provider_only(self):
        request = trip_request()
        with patch("providers.requests.get", side_effect=provider_response):
            flights = flight_node(request)["flight_candidates"]
        write_cache(request, "flights", flights)
        state = {**request, **cache_node(request)}
        with patch("providers.requests.get", side_effect=provider_response) as network:
            self.assertEqual(flight_node(state), {})
            hotels = search_node(state)["hotel_candidates"]
        self.assertEqual(len(hotels), 2)
        self.assertEqual(network.call_count, 1)

    def test_cache_reuses_original_source_timestamp_without_stale_refresh(self):
        with patch("providers.requests.get", side_effect=provider_response):
            first = self.client.post("/plan-trip", json=trip_request()).json()["plan"]
        with patch("providers.requests.get", side_effect=provider_response) as network:
            second = self.client.post("/plan-trip", json=trip_request()).json()["plan"]
        engines = [call.kwargs.get("params", {}).get("engine") for call in network.call_args_list]
        self.assertNotIn("google_flights", engines)
        self.assertNotIn("google_hotels", engines)
        self.assertEqual(first["flights"][0]["source"]["retrieved_at"], second["flights"][0]["source"]["retrieved_at"])

    def test_ai_cannot_invent_places_or_repeat_ids(self):
        state = {**trip_request(), "attraction_candidates": [{"id": "known", "name": "Known place", "address": "Delhi"}]}
        output = ItinerarySelection(days=[
            DaySelection(day=1, place_ids=["invented", "known"]),
            DaySelection(day=2, place_ids=["known"]),
            DaySelection(day=15, place_ids=["known"]),
        ])
        llm = Mock()
        llm.with_structured_output.return_value.invoke.return_value = output
        with patch.dict(os.environ, {"GROQ_API_KEY": "test"}), patch("agents.itinerary.ChatGroq", return_value=llm):
            result = itinerary_node(state)
        self.assertEqual(result["day_place_ids"], {"1": ["known"], "2": []})
        self.assertNotIn("invented", str(result))

    def test_unknown_cost_not_defaulted_to_free_or_invented_price(self):
        request = trip_request()
        budget = budget_for(request, {"price": None}, {"price": None})
        self.assertEqual(budget["known_total"], 0)
        self.assertTrue(all(line["amount"] is None for line in budget["lines"]))
        self.assertEqual(build_plan(request)["selected_hotel_id"], None)

    def test_serpapi_supplies_attractions_without_foursquare(self):
        with patch.dict(os.environ, {"FOURSQUARE_API_KEY": ""}), patch("providers.requests.get", side_effect=provider_response) as network:
            result = attractions_node(trip_request())
        self.assertEqual(len(result["attraction_candidates"]), 4)
        self.assertEqual(result["warnings"], [])
        self.assertEqual(network.call_count, 1)
        self.assertEqual(network.call_args.kwargs["params"]["engine"], "google_local")
        self.assertIn("Delhi", network.call_args.kwargs["params"]["q"])
        self.assertTrue(all(place["source"]["provider"] == "Google Local via SerpAPI" for place in result["attraction_candidates"]))

    def test_place_search_skips_malformed_rows_and_deduplicates(self):
        response = Mock()
        response.json.return_value = {"local_results": [
            None, {"title": 123}, {"title": "Invalid address", "address": []},
            {"place_id": "same", "title": "Known place", "website": "javascript:alert(1)"},
            {"place_id": "same", "title": "Duplicate"},
        ]}
        with patch("providers.requests.get", return_value=response):
            result = attractions_node(trip_request())
        self.assertEqual(len(result["attraction_candidates"]), 1)
        self.assertTrue(result["attraction_candidates"][0]["source"]["url"].startswith("https://www.google.com/maps/"))

    def test_malformed_place_envelope_preserves_other_sections(self):
        response = Mock()
        response.json.return_value = {"local_results": {"unexpected": True}}
        with patch("providers.requests.get", return_value=response):
            self.assertTrue(attractions_node(trip_request())["warnings"])
            self.assertTrue(food_node(trip_request())["warnings"])

    def test_provider_access_and_rate_limit_errors_are_actionable_without_secrets(self):
        for status, expected in ((401, "API key"), (403, "permissions"), (429, "quota")):
            response = requests.Response()
            response.status_code = status
            response.url = "https://serpapi.com/search?api_key=never-display"
            with self.subTest(status=status), patch("providers.requests.get", return_value=response):
                result = flight_node(trip_request())
            self.assertIn(expected, str(result["warnings"]))
            self.assertNotIn("never-display", str(result))

    def test_groq_model_configuration_and_failure_are_explicit(self):
        state = {**trip_request(), "attraction_candidates": [{"id": "known", "name": "Known place", "address": "Delhi"}]}
        with patch.dict(os.environ, {"GROQ_API_KEY": "test", "GROQ_MODEL": "account-model"}), patch("agents.itinerary.ChatGroq", side_effect=RuntimeError("secret detail")) as llm:
            result = itinerary_node(state)
        self.assertEqual(llm.call_args.kwargs["model"], "account-model")
        self.assertIn("known", str(result["day_place_ids"]))
        self.assertIn("GROQ_MODEL", str(result["warnings"]))
        self.assertNotIn("secret detail", str(result))

    def test_empty_ai_assignments_warn_and_fall_back_without_duplicate_places(self):
        place = {"id": "known", "name": "Known place", "address": "Delhi"}
        state = {**trip_request(), "attraction_candidates": [place], "food_recommendations": [place]}
        llm = Mock()
        llm.with_structured_output.return_value.invoke.return_value = ItinerarySelection(days=[])
        with patch.dict(os.environ, {"GROQ_API_KEY": "test"}), patch("agents.itinerary.ChatGroq", return_value=llm):
            result = itinerary_node(state)
        self.assertEqual([item for day in result["day_place_ids"].values() for item in day], ["known"])
        self.assertTrue(any("no usable" in warning for warning in result["warnings"]))

    def test_invalid_request_never_calls_providers(self):
        with patch("providers.requests.get") as network:
            response = self.client.post("/plan-trip", json={**trip_request(), "destination": "BOM"})
        self.assertEqual(response.status_code, 422)
        network.assert_not_called()

    def test_graph_searches_overlap_and_respect_provider_concurrency_limit(self):
        barrier = Barrier(4, timeout=5)
        lock = Lock()
        calls, active, peak = 0, 0, 0

        def concurrent_response(url, **kwargs):
            nonlocal calls, active, peak
            with lock:
                calls += 1
                position = calls
                active += 1
                peak = max(peak, active)
            try:
                if position <= 4:
                    barrier.wait()
                return provider_response(url, **kwargs)
            finally:
                with lock:
                    active -= 1

        with patch("providers.requests.get", side_effect=concurrent_response):
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(peak, 4)
        self.assertEqual(calls, 6)
        plan = response.json()["plan"]
        self.assertEqual(len(plan["flights"]), 1)
        self.assertEqual(len(plan["hotels"]), 2)
        self.assertEqual(sum(len(day["activities"]) for day in plan["days"]), 5)

    def test_busy_planner_rejects_before_spending_provider_quota(self):
        from main import _planning_slots

        acquired = 0
        try:
            for _ in range(2):
                self.assertTrue(_planning_slots.acquire(blocking=False))
                acquired += 1
            with patch("providers.requests.get") as network:
                response = self.client.post("/plan-trip", json=trip_request())
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["Retry-After"], "5")
            network.assert_not_called()
        finally:
            for _ in range(acquired):
                _planning_slots.release()

    def test_failed_plans_release_admission_slots(self):
        for _ in range(3):
            with patch("main.travel_graph.invoke", side_effect=RuntimeError("failure")), self.assertLogs(level="ERROR"):
                response = self.client.post("/plan-trip", json=trip_request())
            self.assertEqual(response.status_code, 503)

    def test_busy_provider_capacity_has_no_network_call(self):
        with patch("providers._provider_slots") as slots, patch("providers.requests.get") as network:
            slots.acquire.return_value = False
            with self.assertRaisesRegex(ProviderUnavailable, "capacity is busy"):
                get_json("https://example.com")
            network.assert_not_called()
            slots.release.assert_not_called()

    def test_provider_timeout_releases_capacity(self):
        with patch("providers._provider_slots") as slots, patch("providers.requests.get", side_effect=requests.Timeout()):
            slots.acquire.return_value = True
            with self.assertRaises(ProviderUnavailable):
                get_json("https://example.com")
            slots.release.assert_called_once()

    def test_place_cache_reuses_destination_across_dates_without_renewal(self):
        request = trip_request()
        with patch("providers.requests.get", side_effect=provider_response) as network:
            first = attractions_node(request)["attraction_candidates"]
            with closing(sqlite3.connect(self.cache_path)) as conn:
                expiry = conn.execute("SELECT expires_at FROM search_cache_v1 WHERE cache_key = ?", (cache_key(request, "attractions"),)).fetchone()[0]
            second = attractions_node({**request, "origin": "BLR", "start_date": "2030-01-01", "end_date": "2030-01-04"})["attraction_candidates"]
        self.assertEqual(first, second)
        self.assertEqual(network.call_count, 1)
        with closing(sqlite3.connect(self.cache_path)) as conn, conn:
            self.assertEqual(conn.execute("SELECT expires_at FROM search_cache_v1 WHERE cache_key = ?", (cache_key(request, "attractions"),)).fetchone()[0], expiry)
            conn.execute("UPDATE search_cache_v1 SET expires_at = 0")
        self.assertIsNone(read_cache(request, "attractions"))
        self.assertNotEqual(cache_key(request, "attractions"), cache_key({**request, "destination": "DXB"}, "attractions"))
        self.assertNotEqual(cache_key(request, "attractions"), cache_key(request, "restaurants"))

    def test_failed_parallel_section_does_not_remove_successful_sections(self):
        def response_with_flight_failure(url, **kwargs):
            if (kwargs.get("params") or {}).get("engine") == "google_flights":
                raise requests.Timeout()
            return provider_response(url, **kwargs)

        with patch("providers.requests.get", side_effect=response_with_flight_failure):
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 200)
        plan = response.json()["plan"]
        self.assertEqual(plan["flights"], [])
        self.assertEqual(len(plan["hotels"]), 2)
        self.assertEqual(plan["budget"]["known_total"], 180.75)
        self.assertTrue(any("timed out" in warning for warning in plan["warnings"]))
        self.assertTrue(any(day["activities"] for day in plan["days"]))

    def test_unexpected_graph_failure_has_explicit_non_success_response(self):
        with patch("main.travel_graph.invoke", side_effect=RuntimeError("internal detail")), self.assertLogs(level="ERROR"):
            response = self.client.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("internal detail", response.text)

    def test_inr_group_request_is_preserved_in_searches_and_budget(self):
        request = {**trip_request(), "destination": "JFK", "currency": "INR", "adults": 3, "max_price": 100000}
        with patch("providers.requests.get", side_effect=provider_response) as network:
            response = self.client.post("/plan-trip", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        plan = response.json()["plan"]
        self.assertEqual(plan["version"], 2)
        self.assertEqual(plan["request"], request)
        self.assertEqual(plan["budget"]["currency"], "INR")
        self.assertEqual(plan["budget"]["known_total"], 322.85)
        self.assertEqual(plan["exchange"]["base"], "INR")
        self.assertEqual(plan["exchange"]["quote"], "USD")
        self.assertEqual(plan["exchange"]["rate"], 0.012)
        for call in network.call_args_list:
            params = call.kwargs.get("params") or {}
            if params.get("engine") in ("google_flights", "google_hotels"):
                self.assertEqual(params["currency"], "INR")
                self.assertEqual(params["adults"], 3)
                self.assertNotIn("rooms", params)
        self.assertTrue(all(quote["currency"] == "INR" for quote in plan["flights"] + plan["hotels"]))

    def test_currency_and_traveler_validation_rejects_unsupported_inputs(self):
        for change in ({"currency": "EUR"}, {"adults": 0}, {"adults": 7}, {"adults": 1.5}, {"adults": True}, {"children": 1}, {"rooms": 2}, {"max_price": 1000001, "currency": "USD"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                TripRequest(**{**trip_request(), **change})
        self.assertEqual(TripRequest(**trip_request()).currency, "USD")
        self.assertEqual(TripRequest(**{**trip_request(), "currency": "INR", "max_price": 10000000}).adults, 1)

    def test_quote_cache_isolates_currency_and_adults(self):
        request = trip_request()
        with patch("providers.requests.get", side_effect=provider_response):
            write_cache(request, "flights", flight_node(request)["flight_candidates"])
        self.assertIsNone(read_cache({**request, "currency": "INR"}, "flights"))
        self.assertIsNone(read_cache({**request, "adults": 2}, "flights"))
        self.assertIsNotNone(read_cache({**request, "currency": "USD", "adults": 1}, "flights"))

    def test_same_currency_skips_reference_provider(self):
        with patch("providers.requests.get") as network:
            result = exchange_node({**trip_request(), "currency": "INR"})
        self.assertEqual(result["exchange"]["rate"], 1)
        self.assertIsNone(result["exchange"]["source_id"])
        network.assert_not_called()

    def test_reference_rates_cache_pairs_without_renewing_evidence(self):
        request = {**trip_request(), "currency": "INR", "destination": "JFK"}
        with patch("providers.requests.get", side_effect=provider_response) as network:
            first = exchange_node(request)
            second = exchange_node(request)
        self.assertEqual(first, second)
        self.assertEqual(network.call_count, 1)
        self.assertEqual(first["exchange_source"]["kind"], "exchange_rate")
        self.assertEqual(network.call_args.args[0], "https://api.frankfurter.dev/v2/rate/inr/usd")
        self.assertIsNone(network.call_args.kwargs["params"])

    def test_invalid_or_stale_rates_do_not_invent_conversions(self):
        request = {**trip_request(), "currency": "INR", "destination": "JFK"}
        for rate in (
            {"rate": 0}, {"rate": -1}, {"rate": float("nan")}, {"rate": True},
            {"date": "2020-01-01"}, {"quote": "GBP"}, {"date": "2099-01-01"},
        ):
            payload = {"date": datetime.now(timezone.utc).date().isoformat(), "base": "INR", "quote": "USD", "rate": 0.012, **rate}
            response = Mock()
            response.json.return_value = payload
            with self.subTest(rate=rate), patch("providers.requests.get", return_value=response):
                result = exchange_node(request)
            self.assertIsNone(result["exchange"]["rate"])
            self.assertTrue(result["warnings"])

    def test_exchange_failure_preserves_original_currency_quotes(self):
        def fail_exchange(url, **kwargs):
            if "frankfurter" in url:
                raise requests.Timeout()
            return provider_response(url, **kwargs)

        with patch("providers.requests.get", side_effect=fail_exchange):
            response = self.client.post("/plan-trip", json={**trip_request(), "currency": "INR", "destination": "JFK", "adults": 2})
        plan = response.json()["plan"]
        self.assertIsNone(plan["exchange"]["rate"])
        self.assertEqual(plan["budget"]["currency"], "INR")
        self.assertEqual(plan["budget"]["known_total"], 322.85)
        self.assertEqual(len(plan["flights"]), 1)


if __name__ == "__main__":
    unittest.main()
