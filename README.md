# AI Travel Planner

A local-first travel planning alpha: create a source-backed draft, see what is
missing from the budget, edit the itinerary, and save or share a copy.

The photographic landing page includes a clearly labeled Delhi demonstration.
Its sample prices, hotel, weather, and savings are not live quotes and are never
saved as a generated trip.

## What works today

| Capability | Behavior |
| --- | --- |
| Honest budgets | Round-trip flight quote plus nightly hotel price multiplied by nights. Meals, transport, activities, taxes, and contingency remain unknown until you enter whole-trip estimates. Unallocated funds are not savings. |
| Grounded drafts | Activities reference retrieved places. Optional AI organizes supplied place IDs only; it cannot add unsupported stops. Times and opening hours are not inferred. |
| Editing | Rename a trip, add or remove activities, move or reorder stops, set times and durations, and see overlap warnings. Editing an activity's name or notes marks it as personal rather than provider-verified. |
| Browser library | Explicitly save up to 30 trips in this browser. No accounts, synchronization, or cloud backup. Clearing browser storage removes saved trips. |
| Sharing and evidence | Export version 2 JSON, import version 1 or 2 files, print to PDF, and inspect provider links and retrieval times. Imported evidence is not independently authenticated or refreshed. |
| Currency and travelers | Plan for 1 to 6 adults sharing one room with an INR or USD group budget. See a dated destination-currency comparison when reference rates are available. |

**Scope:** 1 to 6 adults, one shared room, INR or USD group budgets, round-trip
searches, and 1 to 14 nights. Children and multiple rooms are not supported.
Supported airports: BOM, DEL, HYD, BLR, MAA, CCU, DXB, JFK, LHR, CDG, HND, SIN.
Budget selections are the cheapest retrieved priced flight/stay by default, not
a claim to have searched every option. Confirm the room's occupancy limit and
the final group airfare with the provider.

Enter the budget in your own selected currency; provider quote searches request
that same currency. For example, an INR budget for New York stays in INR, with
a separate USD reference comparison. Switching budget currency clears the form's
numeric budget so an old amount is never silently relabeled or treated as an
exchange conversion. Changing form details does not alter an already open plan.

Flight prices are counted once as returned for the requested adult-count search,
not multiplied by adults again. Stays are a nightly shared-room quote multiplied
by nights, not adults. Personal expense estimates cover the whole group and trip.
Search quotes are not final fares or a guarantee of group availability.

### Destination currency comparison

The [Frankfurter reference-rate API](https://frankfurter.dev/) supplies dated
indicative exchange rates without an API key. It receives only the currency pair,
not your budget, notes, route, or personal information. The app maps supported
destinations to INR, USD, AED, GBP, EUR, JPY, or SGD.

Rates are cached for six hours and must be positive, match the requested pair,
and be dated no more than seven days ago when fetched or reused from the backend
cache. No request is made when both currencies match. If conversion fails,
budgeting stays usable in the original currency and the destination comparison
is unavailable; the app never guesses a rate. This service is reference data,
not a provider for live trading or a guaranteed rate at your bank.

The destination panel distinguishes the whole-trip budget/subtotal equivalent
from your meal, transport, and activity estimates. It does not claim that all
trip costs will be paid at the destination. Unknown categories remain excluded.
Card fees, cash exchange, and rates on travel dates may differ.

Saved trips retain their original dated rate snapshot; opening or importing one
does not refresh rates. Version 1 USD/one-adult plans are normalized on read
without changing stored originals until an explicit save. They have no inferred
historical conversion. Never reinterpret legacy dollars as rupees.

## Run locally

Use Python 3.13 and Node.js 24 for the versions used during local verification.
Ollama and a local model are no longer required by the active planning workflow.

### Backend

From the repository root:

```bash
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Copy the example only for a new setup; do not overwrite an existing `.env`.
Add your own provider keys there, then start:

```bash
venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

The API health check is `http://127.0.0.1:8000/health` and interactive API
documentation is at `http://127.0.0.1:8000/docs`.

| Configuration | Purpose |
| --- | --- |
| `SERPAPI_API_KEY` | Google Flights, Google Hotels, local restaurants, and attraction search through SerpAPI. |
| `FOURSQUARE_API_KEY` | Optional legacy attraction provider used only when SerpAPI is not configured. Not required for the recommended setup; availability and terms must be verified before launch. |
| `GROQ_API_KEY` | Optional AI ordering of retrieved places. Without it, the app uses an unscheduled deterministic draft. |
| `GROQ_MODEL` | Model available to your Groq account, default `openai/gpt-oss-20b`. An inaccessible model produces an explicit fallback warning, not a claim that AI succeeded. |
| `FRONTEND_ORIGINS` | Comma-separated CORS origins, defaulting to localhost and 127.0.0.1 on port 3000. |
| `TRAVEL_CACHE_PATH` | Optional SQLite path, default `travel_cache.db` relative to the backend working directory. |

Current weather uses Open-Meteo without an API key. It is explicitly **not a
forecast for the travel dates**. Missing keys or failed providers produce a partial,
editable draft with warnings, not substituted sample prices or places. Provider
requests may consume your account's quota or incur charges; review your plan
before enabling them.

For the complete recommended planning flow, configure **Groq and SerpAPI**.
One uncached plan makes up to four SerpAPI searches (flights, hotels, restaurants,
attractions), one Groq organization request if places were found, a weather
request, and at most one Frankfurter rate lookup if the currencies differ.
Quote, place, and rate cache hits can reduce requests; cancelling in the browser does
not stop already running provider requests. Model access and provider quotas
must be checked with a real request before claiming live functionality.

### Frontend

In another terminal:

```bash
cd travel-frontend
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open **http://127.0.0.1:3000**. The frontend defaults to the API at
`http://127.0.0.1:8000`. To change it, copy `travel-frontend/.env.example` to
`travel-frontend/.env.local` and set `NEXT_PUBLIC_API_URL`. This is a public
configuration value; never put provider secrets in `NEXT_PUBLIC_*` variables.
Restart development or rebuild production after changing it.

For a production-mode local preview, stop development first, then run:

```bash
cd travel-frontend
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Do not run development and production builds concurrently in the same directory.

## Checks

Backend tests mock all external providers and isolate SQLite in temporary files;
they do not spend live API quota or overwrite your existing cache. Install the
test HTTP client in your virtual environment if it is not already available:

```bash
venv/bin/python -m pip install httpx
venv/bin/python -m unittest discover -s tests -v
cd travel-frontend
npm test
npm run lint
npm run build
```

Frontend tests cover budget arithmetic, file validation, activity movement,
schedule warnings, and browser-storage safeguards. Browser end-to-end checks
performed during development use mocked provider fixtures; they do not prove
live-provider availability or quote accuracy.

## Architecture and data boundaries

- **API:** FastAPI validates airports, future departure dates, trip length, and
  budget. A synchronous route runs the synchronous LangGraph workflow in the
  framework's thread pool.
- **Workflow:** request validation → quote cache → parallel weather, missing
  flight/hotel quotes, restaurants, attractions, and reference conversion → join all searches →
  recommendations → constrained AI ordering or deterministic fallback →
  structured version 2 plan. One failed provider does not discard other results.
- **Concurrency:** each API process accepts at most two active planning jobs.
  Additional requests receive HTTP 429 with `Retry-After: 5` before starting
  provider work. Up to four HTTP provider calls run at once per process; capacity
  waits stop after 15 seconds and become explicit partial-result warnings.
  Groq ordering follows the searches and is bounded by the two active jobs.
  These limits bound concurrency, not requests per minute or account spending.
- **Domain:** `planning.py` builds the plan and initial budget;
  `travel-frontend/lib/trip.ts` validates plans, recomputes edited budgets, and
  implements file/storage operations.
- **Cache:** the versioned SQLite table keys quotes by route, dates, currency,
  adult count, and the fixed single-room scope. Flights expire after 15 minutes; hotels after one
  hour. Restaurant and attraction searches use separate destination-scoped
  six-hour caches and include country in their search queries. Cache hits retain
  their original retrieval timestamp and do not extend expiry. Empty/failed
  results are not cached. Existing legacy tables are preserved.
- **Privacy:** trip requests go to connected providers; saved trips and personal
  edits stay in browser storage unless exported. JSON and PDF files contain trip
  details and notes. No analytics, account system, or automatic cloud backup has
  been added.
- **Cancellation:** cancelling stops the browser waiting for a result. It does
  not guarantee cancellation of an already running backend/provider request or
  avoidance of provider charges.

This alpha is not a booking service. It does not verify opening hours, route
durations, visas, safety conditions, final fares, or availability. It has no
authentication, per-user rate limiting, or public deployment hardening; keep it
bound to localhost. A healthy API process does not imply all external providers
work. Concurrency guards are process-local: running multiple workers multiplies
their limits. A multi-user public beta still needs shared admission/rate limits,
a bounded job queue, spending controls, and load testing against an agreed target.

## Two-week discovery plan

The [customer testing kit](docs/customer-testing/README.md) includes facilitator
scripts, guided tasks, consent guidance, and empty CSV trackers. Copy trackers
into the ignored `research-data/` directory; never commit participant responses.

**Hypothesis, not a validated market:** solo travelers planning a 2 to 4 night
Indian domestic trip need help reconciling a realistic itinerary with total cost.
Start here because the alpha only supports one adult. Couples and groups are
future research segments, not currently supported budget scenarios.

Do not add accounts, payments, affiliate integrations, or more agents during
discovery unless observed problems make them the highest-priority blocker.

| Day | Action | Deliverable |
| --- | --- | --- |
| 1 | Recruit 8 to 10 people who independently planned a domestic trip within six months; include people outside your close friends. Ask for research consent, not signups. | Participant IDs, trip context, interview schedule; no unnecessary personal data. |
| 2 to 4 | Run 20-minute past-trip interviews. Ask for the planning sequence, tools, price surprises, and concrete examples before showing the product. | Anonymized notes separating observations, direct quotes, and founder interpretations. |
| 5 | Group recurring problems and check whether solo travelers are the right first audience. | One primary problem statement and the three most costly planning failures. |
| 6 | Check provider credentials, terms, and 5 real route/date combinations. Manually compare retrieved quote basis, timestamps, and destinations with provider pages. Use a provider quota cap you choose. | Discrepancy log; no claim that cached prices are bookable fares. |
| 7 to 8 | Observe 5 participants using their own upcoming or realistic trip. Do not guide them unless stuck; distinguish independently completed tasks from assisted ones. | Task outcomes, time, errors, hesitation points, and missing-cost recognition. |
| 9 | Fix only the top 1 or 2 repeated blockers; retest changed tasks with 2 participants. | Before/after observations, not just aesthetic opinions. |
| 10 | Review the evidence and decide whether to continue this audience, narrow the problem, or pause acquisition. | A short evidence-based decision and the next two-week scope. |

### Interview prompts

1. Walk me through the last trip you planned, from deciding to travel to booking.
2. Which tools, notes, or messages did you switch between? Show an example if comfortable.
3. What took the most time, and what did you redo?
4. Which costs did you discover late? What changed because of them?
5. What information did you distrust, and how did you check it?
6. Have you paid for planning help or abandoned a plan? What actually happened?

Avoid leading questions such as "Would you use an AI planner?" A compliment,
hypothetical willingness to pay, or a signup is not evidence of repeat use.

### Observed tasks

Ask each participant to generate a draft; explain its known subtotal and unknown
costs; inspect one source and the weather disclosure; change an activity and move
it to another day; add a cost estimate; save and reopen the trip; then export a
copy and explain what is included. Note whether USD, the airport list, or the
one-person restriction prevents their intended use.

If live providers are unavailable, clearly label the session as a fixture-based
usability test. It can evaluate interaction, not sourcing quality or live planning.

### Decision criteria set before testing

These are provisional learning gates for a small sample, not market statistics:

- At least 5 of 8 interviewees independently describe the same concrete problem
  with a recent example. Otherwise revisit the audience/problem before adding features.
- At least 4 of 5 usability participants create, edit, save, and reopen a draft
  without intervention. Record completion time and where assistance was needed.
- At least 4 of 5 distinguish known quotes from unknown costs, unallocated funds
  from savings, and current weather from a travel-date forecast.
- Any invented place/price, destructive save failure, or misleading provenance
  blocks beta expansion until fixed. Record live-provider discrepancies separately.
- Invite participants to return voluntarily for another real planning task and
  record actual return behavior with consent; do not label stated intent as retention.

Use a private local spreadsheet with participant ID, task, outcome, assistance,
elapsed time, issue, severity, and evidence. Do not silently add tracking or send
trip details to a third-party analytics service.

## After discovery

Only if the evidence supports continuing: prioritize validated needs such as INR,
multiple travelers, or route feasibility before a broader launch. Cloud accounts,
durable sharing links, monitoring, rate limits, deployment, provider contracts,
and licensing review belong to a separately approved beta phase. No repository
license has been established here; resolve permission to commercially use and
distribute the code and review media/provider terms before launch.

Original project by Aman Kumar. This working copy extends the prototype into a
local-first alpha; it is not a production-ready public service.
