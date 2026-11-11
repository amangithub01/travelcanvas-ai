import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBudget, convertAmount, formatMoney, moveActivity, parseTripFile, planSchema,
  readTrips, scheduleWarnings, STORAGE_KEY, writeTrip,
} from "./trip.ts";

function fixture() {
  const source = { id: "s1", provider: "Test provider", url: "https://example.com", retrieved_at: "2026-11-10T00:00:00+00:00", kind: "quote" };
  return {
    version: 1, id: "trip1", title: "Delhi itinerary", created_at: source.retrieved_at, updated_at: source.retrieved_at,
    request: { origin: "BOM", destination: "DEL", start_date: "2026-12-10", end_date: "2026-12-12", max_price: 500 },
    days: [0, 1, 2].map((i) => ({
      id: `d${i}`, date: `2026-12-${10 + i}`, title: `Day ${i + 1}`,
      activities: i === 0 ? [{ id: "a1", title: "Known place", notes: "", time: null, duration_minutes: null, source_id: "s1", origin: "provider" }] : [],
    })),
    flights: [{ id: "f1", name: "Flight", price: 142.1, price_basis: "round trip", source: { ...source } }],
    hotels: [{ id: "h1", name: "Hotel", price: 60.25, price_basis: "per night", source: { ...source } }],
    selected_flight_id: "f1", selected_hotel_id: "h1",
    estimates: { meals: null, transport: null, activities: null, taxes: null, contingency: null },
    weather: { summary: "Not available", source_id: null, kind: "unavailable" },
    sources: [source], warnings: [],
  };
}

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("known subtotal counts hotel nights, nulls remain unknown, and estimates are not per-day", () => {
  const plan = planSchema.parse(fixture());
  const base = calculateBudget(plan);
  assert.equal(base.total, 262.6);
  assert.equal(base.remaining, 237.4);
  assert.equal(base.unknown, 5);
  plan.estimates.meals = 42.31;
  assert.equal(calculateBudget(plan).total, 304.91);
  assert.equal(calculateBudget(plan).unknown, 4);
  plan.estimates.contingency = 250;
  assert.equal(calculateBudget(plan).remaining, -54.91);
  plan.selected_flight_id = null;
  assert.equal(calculateBudget(plan).lines[0].amount, null);
});

test("imports reject executable URLs, incorrect references, dates, duplicates, and unsupported versions", () => {
  const invalid = [
    plan => { plan.sources[0].url = "javascript:alert(1)"; },
    plan => { plan.sources[0].url = "https://user:password@example.com"; },
    plan => { plan.version = 2; },
    plan => { plan.selected_flight_id = "missing"; },
    plan => { plan.days[0].activities[0].source_id = "missing"; },
    plan => { plan.days[0].activities[0].origin = "personal"; },
    plan => { plan.days[1].date = plan.days[0].date; },
    plan => { plan.days[1].id = plan.days[0].id; },
    plan => { plan.days[0].activities[0].time = "25:61"; },
    plan => { plan.hotels[0].price = -2; },
    plan => { plan.flights[0].source.provider = "Different provider"; },
  ];
  for (const mutate of invalid) {
    const plan = fixture();
    mutate(plan);
    assert.throws(() => parseTripFile(JSON.stringify(plan)));
  }
  assert.throws(() => parseTripFile("bad json"));
  assert.throws(() => parseTripFile(" ".repeat(2_000_001)));
});

test("budget totals in imported files are discarded and recomputed", () => {
  const plan = parseTripFile(JSON.stringify({ ...fixture(), budget: { known_total: 0, remaining: 500000 } }));
  assert.equal("budget" in plan, false);
  assert.equal(calculateBudget(plan).total, 262.6);
});

test("moving and reordering keeps IDs and source provenance without mutating original", () => {
  const original = fixture();
  const moved = moveActivity(original, "a1", "d1");
  assert.equal(original.days[0].activities.length, 1);
  assert.equal(moved.days[0].activities.length, 0);
  assert.equal(moved.days[1].activities[0].source_id, "s1");
  moved.days[1].activities.push({ ...moved.days[1].activities[0], id: "a2", title: "Second" });
  const ordered = moveActivity(moved, "a2", "d1", -1);
  assert.deepEqual(ordered.days[1].activities.map(activity => activity.id), ["a2", "a1"]);
  assert.equal(moveActivity(original, "a1", "missing"), original);
});

test("schedule warnings catch overlaps and day overflow without inventing route durations", () => {
  const plan = fixture();
  plan.days[0].activities[0].time = "23:00";
  plan.days[0].activities[0].duration_minutes = 120;
  plan.days[0].activities.push({ ...plan.days[0].activities[0], id: "a2", title: "Second", time: "23:30", duration_minutes: null });
  assert.equal(scheduleWarnings(plan).length, 2);
  plan.days[0].activities[0].duration_minutes = null;
  assert.equal(scheduleWarnings(plan).length, 0);
});

test("saving updates the same trip and round-trips edits without losing provenance", () => {
  const local = storage();
  const plan = fixture();
  writeTrip(local, plan);
  plan.title = "My edited trip";
  plan.days[0].activities[0].notes = "Personal note";
  writeTrip(local, plan);
  const saved = readTrips(local);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, "My edited trip");
  assert.equal(saved[0].days[0].activities[0].notes, "Personal note");
  assert.equal(parseTripFile(JSON.stringify(saved[0])).sources[0].provider, "Test provider");
});

test("corrupt storage and quota failures do not silently overwrite saved trips", () => {
  const bad = storage({ [STORAGE_KEY]: "corrupt" });
  assert.throws(() => writeTrip(bad, fixture()));
  assert.equal(bad.getItem(STORAGE_KEY), "corrupt");
  const denied = { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } };
  assert.throws(() => writeTrip(denied, fixture()), /Quota exceeded/);
});

test("the 30-trip limit keeps older plans instead of evicting them", () => {
  const saved = Array.from({ length: 30 }, (_, i) => ({ ...fixture(), id: `saved-${i}` }));
  const local = storage({ [STORAGE_KEY]: JSON.stringify(saved) });
  assert.throws(() => writeTrip(local, fixture()), /30 trips/);
  assert.equal(readTrips(local).length, 30);
  writeTrip(local, { ...saved[0], title: "Updated first trip" });
  assert.equal(readTrips(local)[0].title, "Updated first trip");
});

function inrTrip() {
  const plan = planSchema.parse(fixture());
  plan.request = { ...plan.request, currency: "INR", destination: "JFK", adults: 3, max_price: 100000 };
  for (const quote of [...plan.flights, ...plan.hotels]) quote.currency = "INR";
  const source = { id: "fx", provider: "Reference fixture", url: "https://example.com", retrieved_at: "2026-11-10T00:00:00+00:00", kind: "exchange_rate" };
  plan.sources.push(source);
  plan.exchange = { base: "INR", quote: "USD", rate: 0.012, as_of: "2026-11-10", source_id: source.id };
  return planSchema.parse(plan);
}

test("legacy trips migrate to one adult and USD without rewriting stored originals", () => {
  const original = JSON.stringify([fixture()]);
  const local = storage({ [STORAGE_KEY]: original });
  const [trip] = readTrips(local);
  assert.equal(trip.version, 2);
  assert.equal(trip.request.currency, "USD");
  assert.equal(trip.request.adults, 1);
  assert.equal(trip.exchange.rate, null);
  assert.equal(calculateBudget(trip).total, 262.6);
  assert.equal(local.getItem(STORAGE_KEY), original);
  writeTrip(local, trip);
  assert.equal(JSON.parse(local.getItem(STORAGE_KEY))[0].version, 2);
});

test("group quote is counted once and hotel nights are not multiplied by adults", () => {
  const trip = inrTrip();
  assert.equal(calculateBudget(trip).total, 262.6);
  trip.estimates.meals = 999.99;
  assert.equal(calculateBudget(trip).total, 1262.59);
  assert.equal(convertAmount(100000, trip.exchange), 1200);
  assert.equal(convertAmount(calculateBudget(trip).total, trip.exchange), 15.15);
  assert.match(formatMoney(100000, "INR"), /1,00,000\.00/);
  assert.match(formatMoney(1200, "USD"), /1,200\.00/);
});

test("mixed quote currencies and mismatched or unsupported exchange evidence are rejected", () => {
  for (const mutate of [
    plan => { plan.flights[0].currency = "USD"; },
    plan => { plan.exchange.base = "USD"; },
    plan => { plan.exchange.quote = "JPY"; },
    plan => { plan.exchange.rate = 0; },
    plan => { plan.exchange.source_id = "missing"; },
    plan => { plan.exchange.as_of = null; },
    plan => { plan.exchange.as_of = "2099-01-01"; },
    plan => { plan.request.adults = 7; },
    plan => { plan.request.adults = 1.5; },
  ]) {
    const plan = inrTrip();
    mutate(plan);
    assert.throws(() => parseTripFile(JSON.stringify(plan)));
  }
  const legacy = fixture();
  legacy.request.currency = "INR";
  assert.throws(() => parseTripFile(JSON.stringify(legacy)));
});

test("unavailable conversion stays null and saved exchange rates remain dated snapshots", () => {
  const trip = inrTrip();
  const copy = parseTripFile(JSON.stringify(trip));
  assert.equal(copy.exchange.as_of, "2026-11-10");
  assert.equal(copy.exchange.rate, 0.012);
  copy.exchange = { ...copy.exchange, rate: null, as_of: null, source_id: null };
  assert.equal(convertAmount(100000, planSchema.parse(copy).exchange), null);
  const local = storage();
  writeTrip(local, trip);
  assert.equal(readTrips(local)[0].request.adults, 3);
  assert.equal(readTrips(local)[0].exchange.rate, 0.012);
});
