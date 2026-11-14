import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

import fakeredis
import redis
import requests
from fastapi.testclient import TestClient

from agents.itinerary import itinerary_node
from main import app
from providers import ProviderUnavailable, get_json
from staging import ControlError, Controls, Settings, authenticated_subject
from test_planning import trip_request


class StagingTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "RUN_MODE": "staging", "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test", "REDIS_URL": "redis://localhost:6379/0",
            "FRONTEND_ORIGINS": "https://travel.example.com", "SERPAPI_API_KEY": "fixture",
            "USER_PLANS_PER_MINUTE": "2", "USER_PLANS_PER_DAY": "3", "GLOBAL_PLANS_PER_DAY": "4",
            "MAX_ACTIVE_PLANS": "2", "SERPAPI_DAILY_REQUEST_LIMIT": "2",
            "AI_PROVIDER": "groq",
        })
        self.env.start()
        self.server = fakeredis.FakeServer()
        self.client = fakeredis.FakeRedis(server=self.server, decode_responses=True)
        self.controls = Controls(Settings.from_env(), self.client)
        self.patches = [
            patch("staging.get_controls", return_value=self.controls),
            patch("main.get_controls", return_value=self.controls),
            patch("providers.get_controls", return_value=self.controls),
        ]
        for item in self.patches:
            item.start()
        self.api = TestClient(app)

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.client.close()
        self.env.stop()

    def second_worker(self):
        return Controls(Settings.from_env(), fakeredis.FakeRedis(server=self.server, decode_responses=True))

    def test_staging_configuration_fails_closed_but_local_mode_still_works(self):
        for change in (
            {"RUN_MODE": "production"}, {"SUPABASE_URL": "http://example.com"},
            {"SUPABASE_URL": "https://example.com/not-an-origin"},
            {"SUPABASE_PUBLISHABLE_KEY": "service-role-secret"}, {"REDIS_URL": ""},
            {"FRONTEND_ORIGINS": "*"}, {"FRONTEND_ORIGINS": ""},
            {"FRONTEND_ORIGINS": "http://public.example.com"},
            {"MAX_ACTIVE_PLANS": "0"}, {"REDIS_KEY_PREFIX": "invalid prefix"},
        ):
            with self.subTest(change=change), patch.dict(os.environ, change), self.assertRaises(ValueError):
                Settings.from_env()
        with patch.dict(os.environ, {"RUN_MODE": "local", "REDIS_URL": "", "SUPABASE_URL": ""}):
            local = Controls(Settings.from_env())
            with local.plan(None):
                local.provider("serpapi")
            self.assertEqual(local.ready()["mode"], "local")

    def test_anonymous_and_bad_tokens_never_start_planning(self):
        with patch("staging.requests.get") as auth, patch("main.travel_graph.invoke") as graph:
            response = self.api.post("/plan-trip", json=trip_request())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["WWW-Authenticate"], "Bearer")
        auth.assert_not_called()
        graph.assert_not_called()
        with patch("staging.requests.get", return_value=Mock(status_code=401)), patch("main.travel_graph.invoke") as graph:
            response = self.api.post("/plan-trip", json=trip_request(), headers={"Authorization": "Bearer expired"})
        self.assertEqual(response.status_code, 401)
        graph.assert_not_called()

    def test_confirmed_identity_is_verified_server_side_and_not_logged(self):
        owner = "00000000-0000-4000-8000-000000000001"
        verified = {"id": owner, "role": "authenticated", "email_confirmed_at": "2026-11-13T00:00:00Z"}
        auth = Mock(status_code=200)
        auth.json.return_value = verified
        with patch("staging.requests.get", return_value=auth) as network, patch(
            "main.travel_graph.invoke", side_effect=lambda state: state,
        ), patch("main.request_logger.info") as log:
            response = self.api.post("/plan-trip", json=trip_request(), headers={"Authorization": "Bearer private-token"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(network.call_args.args[0], "https://example.supabase.co/auth/v1/user")
        self.assertFalse(network.call_args.kwargs["allow_redirects"])
        self.assertNotIn("private-token", str(log.call_args))
        self.assertNotIn(owner, str(log.call_args))
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertTrue(response.headers["X-Request-ID"])
        self.assertEqual(self.client.zcard(self.controls.key("active-plans")), 0)
        for user in ({**verified, "is_anonymous": True}, {**verified, "email_confirmed_at": None}):
            auth.json.return_value = user
            with patch("staging.requests.get", return_value=auth), self.assertRaises(ControlError) as error:
                authenticated_subject("Bearer token")
            self.assertEqual(error.exception.status, 401)

    def test_auth_failure_and_ingress_limit_prevent_travel_provider_work(self):
        with patch("staging.requests.get", side_effect=requests.Timeout()), patch("main.travel_graph.invoke") as graph:
            response = self.api.post("/plan-trip", json=trip_request(), headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 503)
        graph.assert_not_called()
        with patch.dict(os.environ, {"INGRESS_PER_MINUTE": "1"}):
            controls = Controls(Settings.from_env(), self.client)
        with patch("staging.get_controls", return_value=controls), patch("staging.requests.get") as auth:
            response = self.api.post("/plan-trip", json=trip_request(), headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 429)
        self.assertTrue(int(response.headers["Retry-After"]) > 0)
        auth.assert_not_called()

    def test_slots_and_per_user_allowances_are_shared_between_workers(self):
        other = self.second_worker()
        with self.controls.plan("person-a"), other.plan("person-b"):
            with self.assertRaises(ControlError) as busy:
                with other.plan("person-c"):
                    self.fail("Shared capacity was not enforced")
            self.assertEqual(busy.exception.status, 429)
        with other.plan("person-a"):
            pass
        with self.assertRaises(ControlError) as limited:
            with self.controls.plan("person-a"):
                self.fail("Per-user limit was not enforced")
        self.assertEqual(limited.exception.status, 429)
        self.assertTrue(0 < limited.exception.retry_after <= 60)
        self.assertFalse(any("person-a" in key for key in self.client.keys("*")))
        self.assertEqual(self.client.zcard(self.controls.key("active-plans")), 0)
        with self.controls.plan("person-c"):
            pass
        with self.assertRaises(ControlError):
            with other.plan("person-d"):
                self.fail("Global day limit was not enforced")

    def test_plan_failures_cleanup_and_expired_or_lost_leases_do_not_leak_capacity(self):
        slots = self.controls.key("active-plans")
        self.client.zadd(slots, {"crashed-worker": 1})
        with self.assertRaisesRegex(RuntimeError, "fixture"):
            with self.controls.plan("person-a"):
                self.assertEqual(self.client.zcard(slots), 1)
                raise RuntimeError("fixture")
        self.assertEqual(self.client.zcard(slots), 0)
        with self.assertRaisesRegex(ControlError, "lease was lost"):
            with self.controls.plan("person-b"):
                self.client.delete(slots)
        self.assertEqual(self.client.zcard(slots), 0)

    def test_provider_daily_reservations_are_atomic_shared_and_fail_closed(self):
        workers = [self.controls, self.second_worker()]

        def reserve(index):
            try:
                workers[index % 2].provider("serpapi")
                return True
            except ControlError:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            accepted = list(pool.map(reserve, range(8)))
        self.assertEqual(sum(accepted), 2)
        with patch("providers.requests.get") as network, self.assertRaises(ProviderUnavailable):
            get_json("https://serpapi.com/search")
        network.assert_not_called()
        keys = self.client.keys(self.controls.key("provider:serpapi:*"))
        self.assertEqual(len(keys), 1)
        self.assertTrue(0 < self.client.ttl(keys[0]) <= 86401)
        self.client.delete(*keys)
        self.controls.provider("serpapi")
        with patch.object(self.client, "eval", side_effect=redis.ConnectionError("redis://hidden-secret")), patch("providers.requests.get") as network:
            with self.assertRaises(ProviderUnavailable) as failure:
                get_json("https://serpapi.com/search")
        self.assertNotIn("hidden-secret", str(failure.exception))
        network.assert_not_called()

    def test_pause_blocks_auth_plans_http_and_groq_before_network_calls(self):
        self.client.set(self.controls.key("paused"), "1")
        with patch("staging.requests.get") as auth:
            response = self.api.post("/plan-trip", json=trip_request(), headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 503)
        auth.assert_not_called()
        with self.assertRaises(ControlError):
            with self.controls.plan("person-a"):
                self.fail("Paused plan was admitted")
        with patch("providers.requests.get") as network, self.assertRaises(ProviderUnavailable):
            get_json("https://api.open-meteo.com/v1/forecast")
        network.assert_not_called()
        with patch.dict(os.environ, {"GROQ_API_KEY": "fixture"}), patch("agents.itinerary.ChatGroq") as llm:
            result = itinerary_node({**trip_request(), "attraction_candidates": [{"id": "p1", "name": "Known place"}]})
        llm.assert_not_called()
        self.assertIn("staging controls", str(result["warnings"]))
        self.assertIn("p1", str(result["day_place_ids"]))
        with patch.dict(os.environ, {"AI_PROVIDER": "ollama", "OLLAMA_URL": "http://localhost:11434"}), patch("agents.itinerary.requests.post") as local_model:
            result = itinerary_node({**trip_request(), "attraction_candidates": [{"id": "p1", "name": "Known place"}]})
        local_model.assert_not_called()
        self.assertIn("staging controls", str(result["warnings"]))

    def test_readiness_does_not_claim_provider_verification_and_redis_outage_is_not_healthy(self):
        with TestClient(app) as client:
            self.assertFalse(client.get("/ready").json()["live_providers_verified"])
        with patch.object(self.client, "ping", side_effect=redis.ConnectionError()):
            self.assertEqual(self.api.get("/ready").status_code, 503)
        self.assertEqual(self.api.get("/health").status_code, 200)
        with patch.dict(os.environ, {"SERPAPI_API_KEY": ""}), self.assertRaises(ControlError):
            self.controls.ready()


if __name__ == "__main__":
    unittest.main()
