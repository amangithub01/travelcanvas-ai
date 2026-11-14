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
| Browser library | Explicitly save up to 30 trips in this browser, independently of optional cloud copies. Clearing browser storage removes browser copies. |
| Sharing and evidence | Export version 2 JSON, import version 1 or 2 files, print to PDF, and inspect provider links and retrieval times. Imported evidence is not independently authenticated or refreshed. |
| Currency and travelers | Plan for 1 to 6 adults sharing one room with an INR or USD group budget. See a dated destination-currency comparison when reference rates are available. |
| Interests and pacing | Optionally choose culture/history, nature, food, and shopping. Relaxed/balanced/packed drafts allow up to 2/3/4 stops on full days and one on arrival/departure days, including food stops. |
| Optional cloud integration | Supabase email/password accounts, explicit private saves with revision conflict detection, and separately published revocable read-only snapshots. Requires project configuration and live verification before use. |

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

### Interests and daily pacing

Interests guide one combined attraction query (not one request per interest) and
the optional Groq ordering of retrieved places. They are soft preferences, not
verified place classifications or guaranteed coverage of every interest.
Restaurant searches remain general; food interests target food markets and
culinary attractions, not dietary restrictions or allergy safety. No extra
provider or paid service is added.

The backend enforces daily stop caps for both AI output and deterministic fallback.
Pacing counts stops, not walking effort or hours; opening hours, route times, and
accessibility remain unverified. Sparse results leave space rather than inventing
stops. Manual edits may exceed the draft cap, with a warning instead of data loss.
Changing form preferences applies only to the next generated plan.

Preferences persist in version 2 exports and browser saves. Older version 1/2
plans default to balanced pacing and general discovery on read, without rewriting
stored originals or regenerating their activities. Personalized attraction caches
include a canonical interest set; changing pacing does not repeat the same search.

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

### Optional Supabase accounts and sharing

Planning and browser saves require no account. To enable the cloud integration:

1. Create your own Supabase project and review its pricing, quotas, region, and
   privacy terms. No project, paid plan, or deployment is created automatically.
2. Apply `supabase/migrations/202611120001_cloud_trips.sql` once in its SQL Editor.
   The migration creates owner-only tables, grants, revision stamping, and a
   token-based read-only snapshot RPC. Do not expose tables without their RLS
   policies or use a service-role key in the browser.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to
   the ignored `travel-frontend/.env.local`. Use the **publishable** key beginning
   `sb_publishable_`, not a secret/service-role key. These two public configuration
   values are bundled into the frontend; actual credentials are managed by Auth.
4. Enable email/password Auth with email confirmation. Configure the Site URL
   and allowed redirect URLs to your exact frontend origin (for local preview,
   `http://127.0.0.1:3000`). Configure a suitable email sender, password rules, and
   Auth rate limits before real users. Confirmation/reset links return to `/`.
5. Rebuild/restart the frontend. Create a test account, confirm its email, verify
   password recovery, and test two different accounts before enabling real data.

The browser-only Supabase SDK handles sessions and email confirmation/recovery.
Sessions persist on the device. Signing in reads only the account's cloud lists;
it never automatically uploads or merges browser trips. “Save to cloud” uploads
the current validated snapshot explicitly. Save again after editing. Cloud and
browser libraries are independent; neither is an automatic backup of the other.
Cloud lists load 100 items per page; load older entries to manage earlier saves
and snapshots. Refresh to see changes made on another device.

Cloud updates/deletes check the last opened or saved revision. If another device
has changed a trip, export your edits, reopen the cloud copy, and reconcile
manually; the app never silently retries an unconditional overwrite. An existing
trip not opened in this session must be opened before it can be overwritten.
Signing out hides cloud lists and share links, but deliberately preserves the
open draft and browser copies. Do not use shared devices for sensitive trips.

Sharing is a separate, explicitly confirmed upload of a **frozen snapshot**.
It includes dates, route, budget, estimates, activity notes and source links.
Anyone holding the link can read it without signing in. The 256-bit random token
is shown once in a URL fragment, not a path/query parameter; only its SHA-256 hash
is stored in the database. The lookup sends the token to your Supabase project's
RPC. Snapshots cannot be edited; create a new link for new content. Links remain
valid until revoked or the owning account is removed. Deleting a private cloud
trip does not delete separately published snapshots. Revoke them explicitly.
Revocation prevents future retrieval, not screenshots, downloaded copies, or a
snapshot already open in another browser. Share pages request no indexing and
use a no-referrer policy, but these are not access controls.

Localhost links are not portable to other devices. Public hosting is a separate
deployment phase. This integration does not authenticate the Python planning API
or provide distributed rate limits, email delivery guarantees, account deletion
UI, collaboration, automatic sync, or production abuse protection.

`supabase/tests/access.sql` exercises the migration's owner isolation, anonymous
denials, revision conflicts, immutable snapshots, bearer lookup and revocation.
Run it only against a **disposable migrated PostgreSQL/Supabase database** using
`psql -v ON_ERROR_STOP=1 -f supabase/tests/access.sql`; fixtures roll back.
Mocked frontend checks do not replace testing actual Supabase Auth, email,
database roles and Data API configuration with two accounts.

## Checks

Backend tests mock all external providers and isolate SQLite in temporary files;
they do not spend live API quota or overwrite your existing cache. Install the
test HTTP client in your virtual environment if it is not already available:

```bash
venv/bin/python -m pip install -r requirements-dev.txt
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

## Protected staging preparation (not a public launch)

The recommended first staging target is a single Docker-capable host behind an
HTTPS reverse proxy, with the Next frontend, Python API and private Redis on that
host, and your separately configured Supabase project for accounts/data. The
included Compose stack binds its gateway only to **127.0.0.1:8080**. It does not
provision a host, domain, TLS certificate, paid service, or public deployment.

`RUN_MODE=local` preserves account-free local planning and process-local limits.
Never publish a local-mode API. `RUN_MODE=staging` requires explicit origins,
Supabase configuration, Redis and SerpAPI credentials; bad/missing control
configuration fails closed rather than falling back to local mode.

Staging requests must carry a Supabase bearer token. The API validates it against
the configured project's `/auth/v1/user` endpoint and requires a confirmed,
non-anonymous account; it never trusts a browser-provided user ID or decoded JWT
claims alone. An Auth outage returns 503; missing/invalid sign-in returns 401.
The frontend's login requirement is UX only; the API is the enforcement boundary.
Signing in to cloud accounts alone does not protect a local-mode planning API.

### Shared limits and request allowances

Redis Lua operations share limits between API workers/replicas using the same
Redis database, key prefix and settings. The staging defaults are:

| Control | Default |
| --- | --- |
| Planner ingress, before Auth calls | 60 attempts/minute globally |
| Accepted plans per account | 2/minute and 10/UTC day |
| Accepted plans across accounts | 50/UTC day |
| Active plans across workers | 2 |
| Logical SerpAPI / Groq attempts | 200 / 50 per UTC day globally |
| Optional local Ollama attempts | 50 per UTC day globally |
| Weather / reference-rate / Foursquare attempts | 200 / 100 / 50 per UTC day globally |

Busy/rate-limited requests return 429 and `Retry-After`, with no planner work.
Accepted plan attempts count even if they later fail or the browser cancels.
Provider allowances are reserved before network/AI calls; failures count, while
cache hits consume no provider allowance. When a section's allowance is exhausted,
it becomes an explicit partial result rather than invented data. Redis failure
blocks new admissions and new provider work; it never silently disables guards.
One process still caps HTTP concurrency at four. Redis admission is shared;
SQLite quote caches remain host-local and are not a distributed cache.

Active plans hold a 180-second Redis lease renewed every 60 seconds. Completion
and failures release it; crashed workers' leases expire. Lost leases reject a
completed result. In-flight remote requests cannot be recalled, including during
a Redis/network partition; lease-based admission is not a guarantee of absolute
concurrency under partitions or suspended workers. There is deliberately **no
backlog queue**: overload is rejected instead of accumulating unbounded jobs.

These are **logical request-count safeguards, not currency/billing caps**.
One provider query may have provider-specific billing, retries/redirects and
other account usage outside this app. Set limits and alerts in the provider
accounts too. Redis persistence loss, eviction, manual deletion, or changing the
key prefix can reset counters. The supplied Redis uses a persistent AOF volume
and `noeviction`; protect/back up it and verify recovery before public use.

### Preparing the local staging stack

1. Finish the Supabase setup above, including the SQL migration, email sender
   and two-account checks. Configure Auth redirects for the staging origin.
2. Copy `deploy/staging.env.example` to the ignored `deploy/staging.env` for a new
   setup. Fill the public Supabase configuration and private travel-provider keys
   there; never paste secret keys in chat, commit the file, or expose them as
   frontend build arguments. Review every allowance before starting.
3. With Docker running, build/start explicitly:

   ```bash
   docker compose --env-file deploy/staging.env -f compose.staging.yml up --build -d
   venv/bin/python scripts/check_staging.py
   ```

4. Open `http://127.0.0.1:8080`, sign in, and separately approve a bounded real
   travel-provider check. The anonymous probe above does not make an authenticated
   travel search. `/health` is liveness; `/ready` checks control dependencies and
   credential presence, **not live-provider access, email, quote correctness or
   Supabase database policy deployment**.

Only the gateway has a loopback host port. Redis has no published port and lives
on a private control network; this single-host template assumes a trusted Docker
host. For a managed Redis, use protected networking/TLS and explicit credentials;
do not expose the supplied Redis or API ports publicly. Public frontend
configuration is embedded at build time; rebuild when origins/Auth settings
change. The frontend image contains no provider keys or `.env` files.
Docker enables `BUILD_STANDALONE=true` for its minimal Node runtime; normal local
builds keep supporting the existing `npm run start` command.

### Optional local Gemma instead of Groq

Set `AI_PROVIDER=ollama` and `OLLAMA_MODEL` to an already installed Gemma tag,
such as `gemma3:1b`. Start Ollama on your own machine. For Docker Desktop, set
`OLLAMA_URL=http://host.docker.internal:11434`; outside Docker, use
`http://127.0.0.1:11434`. Recreate the API after changing its environment.
No model downloads are triggered by the app, and this mode never calls Groq.
Only loopback/localhost or Docker Desktop's host address is accepted, with no
redirects. Keep Ollama private; do not expose its unauthenticated API publicly.

Gemma receives supplied place IDs, names/addresses and scheduling preferences,
not account tokens or passwords. Its JSON output uses the same place validation,
deduplication and pace limits as Groq. A missing model, timeout or invalid result
preserves the source-backed fallback. A local model cannot invent missing flight
or hotel quotes. Local Gemma is not reachable from a publicly hosted Vercel app
unless the backend/model are separately hosted; do not tunnel your Mac for launch.

### Email delivery and split hosting

The default Supabase email sender is restricted to organization team addresses
and has a low hourly allowance. Public signup/reset delivery requires custom
SMTP configured in Supabase, with email confirmation kept enabled. For example,
Resend requires a verified sender domain and uses `smtp.resend.com`, port `465`,
username `resend`, and a private Resend API key as the SMTP password. Save SMTP
credentials only in Supabase's SMTP settings, not in frontend variables or Git.
Review the sender provider's free-plan limits and verify delivery before launch.

Vercel can host the Next frontend, using `travel-frontend` as its root directory.
Set its public API URL to a separately verified HTTPS API origin, configure
Supabase's Site URL/redirects for the actual frontend origin, and include that
origin in backend CORS. Keep `NEXT_PUBLIC_REQUIRE_LOGIN=true`. Never put travel
provider keys in frontend variables. The current Docker API, persistent Redis,
SQLite cache and optional local Gemma need a compatible backend hosting plan;
a frontend-only deployment does not complete a public launch.

For a Vercel-based deployment without a public AI model, the intended split is
two projects from this repository: a root FastAPI backend and a
`travel-frontend` Next.js frontend. `deploy/vercel.env.example` lists their
separate settings. Never copy backend secrets into the frontend project.
The example uses `amanapp.tech` and `api.amanapp.tech`; verify actual domain
ownership/routing and get deployment approval before applying DNS changes.
Use `AI_PROVIDER=none` for public source-backed fallback, not a connection to
local Gemma. The initial example limits SerpAPI to two attempts per UTC day.

A free managed TLS Redis service, such as Upstash, still needs an account,
explicit Free-plan selection, and verification of the existing Lua commands,
UTC counters, sorted-set leases and fail-closed behavior against that service.
Use its Redis protocol connection (`rediss://...`), not the REST URL. Do not
substitute a disposable/expiring database or reset counters to avoid allowances.
Vercel's writable quote cache must live in `/tmp` and may disappear between
invocations; source caches are opportunistic, while quotas must remain shared
in Redis. Provider retries after cache loss still consume the request allowance.
Confirm the projects fit Vercel's current free-plan bundle, duration, concurrency,
usage and terms before launch; otherwise keep deployment blocked rather than
silently enabling billing. Configure preview origins explicitly or leave
unconfigured previews unable to plan.

The gateway bounds request bodies and planning requests per peer, and passes
requests to the authenticated API. Containers run API/frontend/gateway as
non-root users; API/gateway roots are read-only. Application logs contain route
templates, status, duration and a generated request ID—not tokens, subjects,
budgets, prompts, notes or query strings. The API returns `X-Request-ID` and
`Cache-Control: no-store`; query-bearing access logs are disabled in this template.

For an emergency shared pause without resetting counters:

```bash
docker compose --env-file deploy/staging.env -f compose.staging.yml exec redis redis-cli SET travel-staging:paused 1
# Resume only after investigating:
docker compose --env-file deploy/staging.env -f compose.staging.yml exec redis redis-cli DEL travel-staging:paused
```

Pause blocks new Auth/planning admissions and new provider attempts, not already
running network calls, cloud saves or shared snapshots. Keep the Redis volume
when stopping the stack; do not use `down -v` as routine maintenance.

### Release gates still required

Docker image builds, gateway routing, container health, restart/Redis persistence,
two-account hosted Auth/RLS/email flows, bounded live travel queries, a TLS/domain
setup, backup/restore, spending alerts and load testing against an agreed target
must pass before any public deployment. Pin/review image digests and Python
dependency versions for the actual release; the staging templates use maintained
version-family image tags, not an immutable production release manifest.
No live credentials or hosted resources are created by these files. Docker
runtime checks cannot be replaced by linting, Compose parsing or mocked tests.

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
  In local mode these limits bound concurrency, not requests per minute or spending.
  Staging adds the shared admission/rate/request controls documented above.
- **Domain:** `planning.py` builds the plan and initial budget;
  `travel-frontend/lib/trip.ts` validates plans, recomputes edited budgets, and
  implements file/storage operations.
- **Cache:** the versioned SQLite table keys quotes by route, dates, currency,
  adult count, and the fixed single-room scope. Flights expire after 15 minutes; hotels after one
  hour. Restaurant and attraction searches use separate destination-scoped
  six-hour caches and include country in their search queries. Attraction cache
  keys also include selected interests, independently of selection order. Cache hits retain
  their original retrieval timestamp and do not extend expiry. Empty/failed
  results are not cached. Existing legacy tables are preserved.
- **Privacy:** planning requests go to connected providers. Browser-saved edits
  stay local unless exported or explicitly saved/published through configured
  Supabase accounts. Shared snapshots expose included details to link holders.
  No analytics or automatic cloud upload has been added.
- **Cancellation:** cancelling stops the browser waiting for a result. It does
  not guarantee cancellation of an already running backend/provider request or
  avoidance of provider charges.

This alpha is not a booking service. It does not verify opening hours, route
durations, visas, safety conditions, final fares, or availability. It has no
planning-API authentication or distributed limits in local mode; keep that mode
bound to localhost. A healthy API process does not imply all external providers
work. Concurrency guards are process-local: running multiple workers multiplies
the local limits; staging admission is shared through Redis. Neither mode is a
verified public release. A multi-user public beta still needs validated controls,
provider billing safeguards, operational recovery and target-specific load testing.

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
