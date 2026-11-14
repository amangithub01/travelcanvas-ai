import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { cloudSnapshot, createCloudShare, deleteCloudTrip, openCloudTrip, readCloudShare, saveCloudTrip } from "./cloud.ts";

function fixture() {
  const date = "2026-12-10";
  return {
    version: 2, id: "trip1", title: "Test trip", created_at: `${date}T00:00:00Z`, updated_at: `${date}T00:00:00Z`,
    request: { origin: "BOM", destination: "DEL", start_date: date, end_date: "2026-12-11", max_price: 500, currency: "INR", adults: 1, pace: "relaxed", interests: ["nature"] },
    days: [date, "2026-12-11"].map((date, index) => ({ id: `d${index}`, date, title: `Day ${index}`, activities: [] })),
    flights: [], hotels: [], selected_flight_id: null, selected_hotel_id: null,
    estimates: { meals: null, transport: null, activities: null, taxes: null, contingency: null },
    weather: { kind: "unavailable", summary: "Unavailable", source_id: null },
    exchange: { base: "INR", quote: "INR", rate: 1, as_of: null, source_id: null }, sources: [], warnings: [],
  };
}
const summary = { plan_id: "trip1", title: "Test trip", revision: 1, updated_at: "2026-12-10T00:00:00Z" };
function apiWith(handler) {
  return createClient("https://test.supabase.co", "sb_publishable_test", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, options) => {
      const { status = 200, body } = handler(new URL(url), options);
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
}

test("private saves preserve preferences and strip untrusted computed budget totals", async () => {
  let uploaded;
  const api = apiWith((url, options) => {
    uploaded = JSON.parse(options.body);
    return { body: [summary] };
  });
  const plan = fixture();
  plan.budget = { known_total: -999 };
  await saveCloudTrip(api, "owner1", plan, null);
  assert.equal(uploaded.owner_id, "owner1");
  assert.equal("budget" in uploaded.plan, false);
  assert.equal(uploaded.plan.request.pace, "relaxed");
  assert.deepEqual(uploaded.plan.request.interests, ["nature"]);
  assert.throws(() => cloudSnapshot({ ...plan, sources: [{ url: "javascript:alert(1)" }] }));
});

test("stale revision saves and deletes fail without falling back to unconditional overwrites", async () => {
  const calls = [];
  const api = apiWith((url, options) => {
    calls.push({ url, method: options.method });
    return { body: [] };
  });
  await assert.rejects(saveCloudTrip(api, "owner1", fixture(), 3), /changed or was deleted/);
  await assert.rejects(deleteCloudTrip(api, "owner1", "trip1", 3), /changed/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.method), ["PATCH", "DELETE"]);
  for (const { url } of calls) {
    assert.equal(url.searchParams.get("owner_id"), "eq.owner1");
    assert.equal(url.searchParams.get("revision"), "eq.3");
  }
  const conflict = apiWith(() => ({ status: 409, body: { code: "23505" } }));
  await assert.rejects(saveCloudTrip(conflict, "owner1", fixture(), null), /already exists/);
});

test("opening cloud data validates identity and contents before replacing a draft", async () => {
  const valid = apiWith(() => ({ body: { plan: fixture(), revision: 4 } }));
  assert.equal((await openCloudTrip(valid, "owner1", "trip1")).revision, 4);
  await assert.rejects(openCloudTrip(valid, "owner1", "different"), /identity/);
  const invalid = apiWith(() => ({ body: { plan: { ...fixture(), days: [] }, revision: 4 } }));
  await assert.rejects(openCloudTrip(invalid, "owner1", "trip1"));
});

test("publishing sends only a hashed random token and an immutable validated snapshot", async () => {
  const uploads = [];
  const api = apiWith((url, options) => {
    uploads.push(JSON.parse(options.body));
    return { body: { id: "00000000-0000-4000-8000-000000000001", plan_id: "trip1", title: "Test trip", created_at: summary.updated_at } };
  });
  const plan = fixture();
  const first = await createCloudShare(api, "owner1", plan);
  const second = await createCloudShare(api, "owner1", plan);
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal("token" in uploads[0], false);
  assert.notEqual(uploads[0].token_hash, first.token);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(first.token))).toString("hex");
  assert.equal(uploads[0].token_hash, hash);
  plan.title = "Later private edit";
  assert.equal(uploads[0].plan.title, "Test trip");
});

test("invalid links do not make a lookup, and revoked/malformed snapshots fail closed", async () => {
  let requests = 0;
  const missing = apiWith(() => { requests++; return { body: null }; });
  await assert.rejects(readCloudShare(missing, "../invalid"), /invalid/);
  assert.equal(requests, 0);
  await assert.rejects(readCloudShare(missing, "a".repeat(64)), /revoked/);
  const invalid = apiWith(() => ({ body: { ...fixture(), selected_flight_id: "missing" } }));
  await assert.rejects(readCloudShare(invalid, "a".repeat(64)));
  const valid = apiWith(() => ({ body: fixture() }));
  assert.equal((await readCloudShare(valid, "a".repeat(64))).title, "Test trip");
});
