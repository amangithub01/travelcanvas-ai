import { z } from "zod";

export const AIRPORT_CODES = ["BOM", "DEL", "HYD", "BLR", "MAA", "CCU", "DXB", "JFK", "LHR", "CDG", "HND", "SIN"] as const;
export const ESTIMATE_KEYS = ["meals", "transport", "activities", "taxes", "contingency"] as const;
export const PACES = ["relaxed", "balanced", "packed"] as const;
export const PACE_LIMITS = { relaxed: 2, balanced: 3, packed: 4 } as const;
export const INTEREST_LABELS = { culture: "Culture & history", nature: "Nature", food: "Food", shopping: "Shopping" } as const;
export const INTERESTS = ["culture", "nature", "food", "shopping"] as const;
export const CURRENCIES = ["INR", "USD", "AED", "GBP", "EUR", "JPY", "SGD"] as const;
export const DESTINATION_CURRENCIES: Record<string, typeof CURRENCIES[number]> = {
  BOM: "INR", DEL: "INR", HYD: "INR", BLR: "INR", MAA: "INR", CCU: "INR",
  DXB: "AED", JFK: "USD", LHR: "GBP", CDG: "EUR", HND: "JPY", SIN: "SGD",
};
const budgetCurrency = z.enum(["INR", "USD"]);
const amount = z.number().finite().min(0).max(100_000_000);
const identifier = z.string().min(1).max(100);
const timestamp = z.iso.datetime({ offset: true });
const dateOnly = z.iso.date();
const httpsUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
});

export const requestSchema = z.object({
  origin: z.enum(AIRPORT_CODES),
  destination: z.enum(AIRPORT_CODES),
  start_date: dateOnly,
  end_date: dateOnly,
  max_price: amount.positive(),
  currency: budgetCurrency.default("USD"),
  adults: z.number().int().min(1).max(6).default(1),
  pace: z.enum(PACES).default("balanced"),
  interests: z.array(z.enum(INTERESTS)).max(4).refine(values => new Set(values).size === values.length, "Choose each interest only once.").default([]),
}).refine(value => value.currency !== "USD" || value.max_price <= 1_000_000, "USD budgets must not exceed 1,000,000.")
  .refine(value => value.origin !== value.destination, "Choose different airports.")
  .refine(value => {
    const nights = (Date.parse(value.end_date) - Date.parse(value.start_date)) / 86400000;
    return nights >= 1 && nights <= 14;
  }, "Choose a trip of 1 to 14 nights.");

const sourceSchema = z.object({
  id: identifier,
  provider: z.string().min(1).max(200),
  url: httpsUrl.nullable(),
  retrieved_at: timestamp,
  kind: z.enum(["quote", "search", "current_weather", "exchange_rate"]),
});

const quoteSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(300),
  price: amount.nullable(),
  currency: budgetCurrency,
  price_basis: z.string().max(500),
  source: sourceSchema,
  departure: z.string().max(100).nullable().optional(),
  arrival: z.string().max(100).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
});

const activitySchema = z.object({
  id: identifier,
  title: z.string().min(1).max(200),
  notes: z.string().max(2000),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  duration_minutes: z.number().int().min(5).max(1440).nullable(),
  source_id: identifier.nullable(),
  origin: z.enum(["provider", "personal"]),
});

const currentPlanSchema = z.object({
  version: z.literal(2),
  id: identifier,
  title: z.string().min(1).max(200),
  created_at: timestamp,
  updated_at: timestamp,
  request: requestSchema,
  days: z.array(z.object({
    id: identifier,
    date: dateOnly,
    title: z.string().min(1).max(200),
    activities: z.array(activitySchema).max(20),
  })).min(2).max(15),
  flights: z.array(quoteSchema).max(20),
  hotels: z.array(quoteSchema).max(20),
  selected_flight_id: identifier.nullable(),
  selected_hotel_id: identifier.nullable(),
  estimates: z.object({
    meals: amount.nullable(), transport: amount.nullable(), activities: amount.nullable(),
    taxes: amount.nullable(), contingency: amount.nullable(),
  }),
  weather: z.object({
    summary: z.string().max(1000),
    source_id: identifier.nullable(),
    kind: z.enum(["current", "unavailable"]),
  }),
  sources: z.array(sourceSchema).max(100),
  warnings: z.array(z.string().max(1000)).max(50),
  exchange: z.object({
    base: budgetCurrency,
    quote: z.enum(CURRENCIES),
    rate: z.number().finite().positive().max(1_000_000).nullable(),
    as_of: dateOnly.nullable(),
    source_id: identifier.nullable(),
  }),
}).superRefine((plan, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  const sources = new Set(plan.sources.map(source => source.id));
  if (!unique(plan.sources.map(source => source.id))) fail("Duplicate sources.");
  if (!unique(plan.days.map(day => day.id))) fail("Duplicate day IDs.");
  if (!unique(plan.days.flatMap(day => day.activities.map(activity => activity.id)))) fail("Duplicate activity IDs.");
  if (!unique(plan.flights.map(quote => quote.id)) || !unique(plan.hotels.map(quote => quote.id))) fail("Duplicate quote IDs.");
  const expectedDays = (Date.parse(plan.request.end_date) - Date.parse(plan.request.start_date)) / 86400000 + 1;
  if (expectedDays !== plan.days.length) fail("Day count does not match trip dates.");
  plan.days.forEach((day, i) => {
    if (Date.parse(day.date) !== Date.parse(plan.request.start_date) + i * 86400000) fail("Trip days must match dates in order.");
    day.activities.forEach(activity => {
      if (activity.source_id && !sources.has(activity.source_id)) fail("Activity source does not exist.");
      if (activity.origin === "provider" && !activity.source_id) fail("Provider activities require a source.");
      if (activity.origin === "personal" && activity.source_id) fail("Personal activities cannot claim provider evidence.");
    });
  });
  for (const quote of [...plan.flights, ...plan.hotels]) {
    if (quote.currency !== plan.request.currency) fail("Quote currency does not match the budget currency.");
    if (!sources.has(quote.source.id)) fail("Quote source does not exist.");
    const evidence = plan.sources.find(source => source.id === quote.source.id);
    if (evidence && JSON.stringify(evidence) !== JSON.stringify(quote.source)) fail("Quote source metadata does not match.");
  }
  if (plan.weather.source_id && !sources.has(plan.weather.source_id)) fail("Weather source does not exist.");
  if (plan.selected_flight_id && !plan.flights.some(quote => quote.id === plan.selected_flight_id)) fail("Selected flight does not exist.");
  if (plan.selected_hotel_id && !plan.hotels.some(quote => quote.id === plan.selected_hotel_id)) fail("Selected stay does not exist.");
  const exchange = plan.exchange;
  if (exchange.base !== plan.request.currency || exchange.quote !== DESTINATION_CURRENCIES[plan.request.destination]) fail("Exchange pair does not match the trip.");
  if (exchange.base === exchange.quote) {
    if (exchange.rate !== 1 || exchange.as_of !== null || exchange.source_id !== null) fail("Same-currency comparison must use an identity rate.");
  } else if (exchange.rate === null) {
    if (exchange.source_id !== null || exchange.as_of !== null) fail("Unavailable exchange rates cannot claim source evidence.");
  } else {
    const evidence = plan.sources.find(source => source.id === exchange.source_id);
    if (!exchange.as_of || !evidence || evidence.kind !== "exchange_rate") fail("Currency conversion requires dated exchange-rate evidence.");
    if (exchange.as_of && evidence && exchange.as_of > evidence.retrieved_at.slice(0, 10)) fail("Exchange date cannot be after retrieval.");
  }
});

function upgradeLegacy(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return value;
  const legacy = value as Record<string, unknown>;
  const request = legacy.request as Record<string, unknown> | undefined;
  if (!request || (request.currency !== undefined && request.currency !== "USD") || (request.adults !== undefined && request.adults !== 1)) return value;
  if (!Array.isArray(legacy.flights) || !Array.isArray(legacy.hotels)) return value;
  const quotes = [...legacy.flights, ...legacy.hotels];
  if (quotes.some(quote => !quote || typeof quote !== "object" || ("currency" in quote && quote.currency !== "USD"))) return value;
  const quote = DESTINATION_CURRENCIES[String(request.destination)];
  return {
    ...legacy, version: 2, request: { ...request, currency: "USD", adults: 1 },
    flights: legacy.flights.map(item => ({ ...(item as Record<string, unknown>), currency: "USD" })),
    hotels: legacy.hotels.map(item => ({ ...(item as Record<string, unknown>), currency: "USD" })),
    exchange: { base: "USD", quote, rate: quote === "USD" ? 1 : null, as_of: null, source_id: null },
  };
}

export const planSchema = z.preprocess(upgradeLegacy, currentPlanSchema);

export type TripPlan = z.infer<typeof planSchema>;
export type Activity = TripPlan["days"][number]["activities"][number];
export type TripRequest = z.infer<typeof requestSchema>;
export type Source = TripPlan["sources"][number];
export const STORAGE_KEY = "ai-travel-planner.trips.v1";
export const MAX_IMPORT_BYTES = 2_000_000;

export function calculateBudget(plan: TripPlan) {
  const nights = plan.days.length - 1;
  const flight = plan.flights.find(item => item.id === plan.selected_flight_id);
  const hotel = plan.hotels.find(item => item.id === plan.selected_hotel_id);
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
  const lines = [
    { key: "flights", label: "Flights", amount: flight?.price == null ? null : cents(flight.price), basis: `Round-trip quote · ${plan.request.adults} adult(s) · not multiplied again`, kind: "Quote" },
    { key: "stays", label: "Stays", amount: hotel?.price == null ? null : cents(hotel.price) * nights, basis: `One shared room × ${nights} nights`, kind: "Quote" },
    ...ESTIMATE_KEYS.map(key => ({ key, label: key[0].toUpperCase() + key.slice(1), amount: plan.estimates[key] === null ? null : cents(plan.estimates[key]), basis: "Your whole-trip group estimate", kind: "Estimate" })),
  ];
  const total = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  return { lines: lines.map(line => ({ ...line, amount: line.amount === null ? null : line.amount / 100 })), total: total / 100, remaining: (cents(plan.request.max_price) - total) / 100, unknown: lines.filter(line => line.amount === null).length };
}

export function formatMoney(value: number, currency: typeof CURRENCIES[number]) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, currencyDisplay: "code",
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(value);
}

export function convertAmount(value: number, exchange: TripPlan["exchange"]) {
  if (exchange.rate === null) return null;
  const factor = exchange.quote === "JPY" ? 1 : 100;
  return Math.round((value * exchange.rate + Number.EPSILON) * factor) / factor;
}

export function scheduleWarnings(plan: TripPlan) {
  const warnings: string[] = [];
  for (const [index, day] of plan.days.entries()) {
    const limit = index === 0 || index === plan.days.length - 1 ? 1 : PACE_LIMITS[plan.request.pace];
    if (day.activities.length > limit) warnings.push(`${day.date}: ${day.activities.length} stops exceeds the ${limit}-stop draft guideline. Your edits are kept; check whether this day is realistic.`);
    const timed = day.activities.filter(activity => activity.time).map(activity => ({
      ...activity,
      start: Number(activity.time!.slice(0, 2)) * 60 + Number(activity.time!.slice(3)),
    })).sort((a, b) => a.start - b.start);
    for (let i = 0; i < timed.length; i++) {
      const current = timed[i];
      if (current.duration_minutes && current.start + current.duration_minutes > 1440) warnings.push(`${day.date}: ${current.title} extends beyond this day.`);
      const next = timed[i + 1];
      if (next && (current.start === next.start || (current.duration_minutes && current.start + current.duration_minutes > next.start))) warnings.push(`${day.date}: ${current.title} overlaps ${next.title}.`);
    }
  }
  return warnings;
}

export function moveActivity(plan: TripPlan, activityId: string, targetDayId: string, offset?: -1 | 1): TripPlan {
  const from = plan.days.find(day => day.activities.some(activity => activity.id === activityId));
  const target = plan.days.find(day => day.id === targetDayId);
  if (!from || !target) return plan;
  const activity = from.activities.find(item => item.id === activityId)!;
  if (offset) {
    if (from.id !== target.id) return plan;
    const items = [...from.activities];
    const index = items.findIndex(item => item.id === activityId);
    const next = index + offset;
    if (next < 0 || next >= items.length) return plan;
    [items[index], items[next]] = [items[next], items[index]];
    return { ...plan, days: plan.days.map(day => day.id === from.id ? { ...day, activities: items } : day) };
  }
  if (from.id === target.id || target.activities.length >= 20) return plan;
  return { ...plan, days: plan.days.map(day => day.id === from.id ? { ...day, activities: day.activities.filter(item => item.id !== activityId) } : day.id === target.id ? { ...day, activities: [...day.activities, activity] } : day) };
}

export function parseTripFile(text: string): TripPlan {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("Trip files must be smaller than 2 MB.");
  const parsed = planSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("This is not a supported version 1 or 2 trip file. No existing trips were changed.");
  return parsed.data;
}

export function readTrips(storage: Pick<Storage, "getItem">): TripPlan[] {
  const text = storage.getItem(STORAGE_KEY);
  if (!text) return [];
  const raw = JSON.parse(text);
  if (!Array.isArray(raw) || raw.length > 30) throw new Error("Saved trip data is unreadable. Export your current plan before clearing browser storage.");
  return raw.map(item => planSchema.parse(item));
}

export function writeTrip(storage: Pick<Storage, "getItem" | "setItem">, plan: TripPlan) {
  const validated = planSchema.parse(plan);
  const existing = readTrips(storage);
  if (existing.length >= 30 && !existing.some(item => item.id === plan.id)) throw new Error("This browser holds 30 trips. Export and delete an old trip before saving another.");
  const trips = [validated, ...existing.filter(item => item.id !== plan.id)];
  storage.setItem(STORAGE_KEY, JSON.stringify(trips));
  return trips;
}
