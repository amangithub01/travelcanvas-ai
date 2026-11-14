import test, { mock } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
const { planTrip } = await import("./api.ts");
const { getCloudClient } = await import("./cloud.ts");

function fixture() {
  const date = "2026-12-10";
  return {
    version: 2, id: "trip1", title: "Test trip", created_at: `${date}T00:00:00Z`, updated_at: `${date}T00:00:00Z`,
    request: { origin: "BOM", destination: "DEL", start_date: date, end_date: "2026-12-11", max_price: 500, currency: "INR", adults: 1 },
    days: [date, "2026-12-11"].map((date, index) => ({ id: `d${index}`, date, title: `Day ${index}`, activities: [] })),
    flights: [], hotels: [], selected_flight_id: null, selected_hotel_id: null,
    estimates: { meals: null, transport: null, activities: null, taxes: null, contingency: null },
    weather: { kind: "unavailable", summary: "Unavailable", source_id: null },
    exchange: { base: "INR", quote: "INR", rate: 1, as_of: null, source_id: null }, sources: [], warnings: [],
  };
}

test("staging sign-in is required before making a planning request", async () => {
  process.env.NEXT_PUBLIC_REQUIRE_LOGIN = "true";
  const session = mock.method(getCloudClient().auth, "getSession", async () => ({ data: { session: null }, error: null }));
  const network = mock.method(globalThis, "fetch", async () => { throw new Error("Should not send request"); });
  try {
    await assert.rejects(planTrip(fixture().request), /Sign in/);
    assert.equal(network.mock.callCount(), 0);
  } finally { session.mock.restore(); network.mock.restore(); delete process.env.NEXT_PUBLIC_REQUIRE_LOGIN; }
});

test("signed-in planning sends the bearer token while keeping trip data separate", async () => {
  const session = mock.method(getCloudClient().auth, "getSession", async () => ({ data: { session: { access_token: "mock-access-token" } }, error: null }));
  let uploaded;
  const network = mock.method(globalThis, "fetch", async (url, options) => {
    uploaded = options;
    return new Response(JSON.stringify({ plan: fixture() }));
  });
  try {
    assert.equal((await planTrip(fixture().request)).id, "trip1");
    assert.equal(uploaded.headers.Authorization, "Bearer mock-access-token");
    assert.equal("access_token" in JSON.parse(uploaded.body), false);
  } finally { session.mock.restore(); network.mock.restore(); }
});

test("local planning stays anonymous and staging errors do not become successful drafts", async () => {
  const session = mock.method(getCloudClient().auth, "getSession", async () => ({ data: { session: null }, error: null }));
  let status = 200, authorization;
  const network = mock.method(globalThis, "fetch", async (url, options) => {
    authorization = options.headers.Authorization;
    return new Response(JSON.stringify(status === 200 ? { plan: fixture() } : { detail: "Planning is paused by the staging operator." }), { status });
  });
  try {
    await planTrip(fixture().request);
    assert.equal(authorization, undefined);
    status = 503;
    await assert.rejects(planTrip(fixture().request), /paused/);
  } finally { session.mock.restore(); network.mock.restore(); }
});

test("non-JSON gateway rate limits produce an actionable error instead of a JSON parser failure", async () => {
  const session = mock.method(getCloudClient().auth, "getSession", async () => ({ data: { session: null }, error: null }));
  const network = mock.method(globalThis, "fetch", async () => new Response("<html>Too many requests</html>", { status: 429 }));
  try { await assert.rejects(planTrip(fixture().request), /gateway is limiting requests/); }
  finally { session.mock.restore(); network.mock.restore(); }
});
