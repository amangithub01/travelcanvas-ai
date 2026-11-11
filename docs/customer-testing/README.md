# Customer testing kit

Use this kit to test the discovery hypothesis, not to demonstrate a finished
product. No interviews have been conducted and the CSV templates contain no
results.

Start Day 1 with [recruitment channels, screening, and outreach messages](recruitment.md).

**First audience:** people who personally planned a 2 to 4 night solo trip within
India in the past six months. Recruit 8 to 10 for interviews, including people
outside your close friends, and 5 for usability sessions. Record departures from
this audience rather than silently combining different segments.

## Prepare one session

1. Copy the CSV templates into the ignored `research-data/` directory:

   ```bash
   mkdir -p research-data
   cp docs/customer-testing/templates/*.csv research-data/
   ```

   Run this once from the repository root. Do not copy over trackers containing
   existing notes. Use a local spreadsheet editor without cloud synchronization.
2. Assign a participant ID such as `P01`; do not put names, emails, phone numbers,
   booking references, or precise personal travel details in these trackers.
   Keep any necessary scheduling contacts separately with restricted access.
3. Use a dedicated test browser profile, not your personal profile or a previous
   participant's browser library. Do not delete someone's real saved trips.
4. Choose the session mode: `live`, `sample_only`, or `imported_fixture`.
   Check `/health` and the page, then check provider availability separately.
   Generating a live plan can spend provider quota; choose a request limit before
   the session. Do not repeatedly submit when a provider fails.
5. Have [the interview script](interview.md) or
   [the usability script](usability.md) open. Conduct the interview before showing
   the product, ideally in a separate session.

Keep the app on localhost. A participant can use your computer in person or
control the test browser during a consensual screen-sharing call. This is not
permission to expose the unprotected API publicly.

## Consent and data handling

Read this before taking notes:

> We are testing an early travel-planning prototype, not you. Participation is
> voluntary. You can skip any question or stop at any time. Nothing is booked.
> With your permission, I will take notes under a participant ID, without your
> name or contact details. I propose deleting raw notes and test files within
> 30 days after the session. Is note-taking on those terms okay?

Record the answer and agreed deletion date. If declined, do not collect notes or
tracker rows containing their responses. Do not record audio/video by default;
recording needs separate explicit consent and an agreed storage/deletion plan.
Do not treat consent to research as consent to marketing, telemetry, or follow-up.
Ask separately before a later invitation.

Before entering a trip, explain:

> In live mode, the origin, destination, dates, and budget go to the local backend;
> connected travel providers receive relevant search details. Saved plans remain
> in this browser unless exported. Exported JSON and PDFs include the trip and
> notes. Please use a hypothetical trip and avoid sensitive information.

Explain sample/fixture modes honestly: their prices and sources are examples,
not evidence of current provider accuracy. Imported files are not independently
verified. Do not ask for passport information, payment details, passwords, or
personal booking documents.

The ignored `research-data/` directory prevents accidental Git inclusion, not
unauthorized access or backup. Store it on a protected local disk; do not upload
notes, recordings, or participant trip files to GitHub or external AI services.
Honor withdrawal requests and agreed deletion dates. Keep only anonymized
aggregate learning when appropriate; do not retain identifiable quotes.

## Track evidence consistently

| File | One row represents | Rules |
| --- | --- | --- |
| `sessions.csv` | One consented interview or usability session | Use a unique session ID, such as `I01` or `U01`. Reuse participant IDs across sessions. |
| `observations.csv` | One observed behavior or reported past event | `evidence_type`: `observation`, `reported_event`, `direct_quote`, or `interpretation`. Separate interpretations from evidence; identify any prompted response. |
| `tasks.csv` | One participant's attempt at one usability task | Use task IDs from the script; record outcomes and seconds, not guessed completion times. |
| `issues.csv` | One distinct product problem | Link session/task IDs. Repeated occurrences belong to one issue, not several inflated issue counts. |
| `provider-checks.csv` | One manual live-provider comparison | Compare equivalent route, dates, currency, traveler/room count, and price basis. Redact URLs containing keys or personal information. |

Use CSV quoting when text contains commas, quotes, or newlines. In spreadsheets,
import participant text as plain text; do not execute formulas beginning with
`=`, `+`, `-`, or `@`. Do not paste raw provider responses or authentication
headers into trackers.

Suggested issue severity:

- `blocker`: lost saved data, invented content presented as sourced, unsafe
  handling of data, or materially misleading budget/provenance.
- `high`: cannot complete a core task without intervention.
- `medium`: recoverable confusion or repeated friction.
- `low`: minor friction that does not prevent completion.

Use issue status `open`, `in_progress`, `fixed`, or `retested`. A code change alone
does not establish that the participant's problem is resolved.

## Day 10 decision

Fix these criteria before recruiting. Use the first 8 eligible, consented,
completed interviews and first 5 eligible usability sessions as the primary
sample; label extras and retests separately. Do not cherry-pick results, replace
struggling participants, or silently change the criteria after seeing outcomes.
If you lack the sample, mark the decision **insufficient evidence**.

1. **Problem:** at least 5 of 8 independently describe the same concrete problem
   with a recent example. Count people, not mentions. Separate prompted answers
   and founder interpretations.
2. **Core workflow:** at least 4 of 5 complete T1, T4, and T6 independently.
   An assisted task does not become an independent success after coaching.
   Report live, sample, and imported-fixture results separately. Sample-only
   mode cannot establish that the generated-trip workflow succeeds.
3. **Trust comprehension:** at least 4 of 5 independently distinguish known
   quotes, unknown expenses, unallocated funds, and current versus future weather
   in T2 and T3. Code partial answers as partial, not complete.
4. **Trust blockers:** any invented place/price presented as real, destructive
   save failure, or misleading provenance stops beta expansion until resolved.
5. **Return behavior:** report voluntary return use only when actually observed
   with consent. A promise to return or willingness to pay is not retention.

Write the decision in your private notes using this structure:

> Sample and modes; strongest observed problem; independent workflow completion;
> trust comprehension; unresolved blockers; provider discrepancies; actual return
> behavior if any; decision (continue, narrow, pause, or insufficient evidence);
> next two changes and why.

Do not infer market size, conversion rates, or product-market fit from this small
sample. The outcome should choose the next experiment, not justify building
accounts, payments, or public deployment automatically.
