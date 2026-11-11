# Observed usability session: 30 minutes

**Goal:** learn whether someone can turn a draft into a plan they understand and
can keep. Use the consent and mode rules in [the kit guide](README.md).

## Setup and facilitator rules

Use a fresh dedicated browser profile. Confirm the application loads before the
participant arrives. Record the session's app version/build or local change
description so a retest is distinguishable from the original.

Choose a hypothetical 2 to 4 night future domestic trip between supported
airports. Use a USD budget without pretending it is INR; record currency friction.
In live mode, obtain permission for the searches and set a request/quota limit.
Do not make bookings or take payment.

Read:

> This is an early prototype. We are testing the design, not your ability.
> Please say what you expect and what you are looking for. I will mostly watch.
> You can stop, skip a task, or ask for help. Nothing here is booked.

Do not point at controls, explain unfamiliar terms, or correct misunderstandings
until the participant finishes their first attempt. If they request help or make
no progress for about 90 seconds, ask if they want a hint; label any hint or
intervention as assistance. Stop a task after about three active minutes unless
they choose to continue. Pause timing for provider waits and log wait seconds
separately. Do not claim a controlled performance benchmark.

## Task prompts and scoring

Show only the **prompt** to the participant; success criteria are facilitator
notes. Start the task timer after reading the prompt.

| ID | Participant prompt | Independent success criteria |
| --- | --- | --- |
| T1 | Make a draft for this trip. Tell me when you think it is ready to review. | Chooses distinct supported airports, future dates, and a valid budget; submits and recognizes the resulting draft or its missing-data state without help. |
| T2 | What can you tell about how much this trip will cost? What, if anything, is still uncertain? | Distinguishes retrieved quotes from unknown categories; recognizes the subtotal is incomplete and unallocated funds are not savings. Do not supply these words first. |
| T3 | Choose one recommendation you might rely on. How would you check it? What does the weather tell you about the trip? | Finds source/retrieval evidence or correctly identifies its absence; recognizes current weather is not the trip-date forecast and quotes are not bookings. |
| T4 | Change one stop to something you prefer and put it on a different day. | Enters editing, changes an activity, moves it, and identifies the new location without help. |
| T5 | Include a whole-trip food allowance of $60. What changed in your cost picture? | Enters 60 for meals, recognizes its whole-trip scope, and correctly explains the changed subtotal/unallocated funds. |
| T6 | Keep this plan for later. Leave the open workspace by reloading this page, then bring your saved plan back. | Explicitly saves before reloading, reopens from My trips, and confirms the edits remain. Participant handles any unsaved-warning prompt; do not override it for them. |
| T7 | Make an editable copy that you could give a travel companion. Tell me what you would be sharing. | Exports JSON and understands it contains trip details/notes rather than a private cloud link. |
| T8 | Make a version someone can read without editing. | Finds PDF/print, inspects the preview, and understands it is not editable JSON. No actual file needs to be retained. |

Finish with:

> Where do you think the saved plan lives? What would happen if this browser's
> data were cleared? What, if anything, would you check before booking?

Record the participant's first answer before clarifying local storage, missing
verification, or sample data. Do not score a corrected answer as independent
understanding.

## Missing data and alternative session modes

- **Live partial result:** do not call it a successful sourced plan. Record which
  providers are missing. Manual activity addition can support later tasks but
  does not demonstrate recommendation quality. Mark affected tasks partial or
  blocked rather than inventing evidence.
- **Imported fixture:** manually prepare a hypothetical JSON in the app, export
  it, and identify it clearly as facilitator-supplied sample content. Do not label
  invented places, prices, or personal activities as provider-backed. Import it
  before T2; mark T1 `not_run` because live generation was not evaluated.
- **Sample only:** use the landing demo to discuss comprehension, but do not
  claim save/edit completion: the showcase is intentionally not a real trip.
  Mark unavailable tasks `not_run`, not successful.

Do not silently switch modes halfway through a session. If a switch is necessary,
record it in the notes and each affected task's `mode`; report results separately.

## Record and close

For each attempted task, use outcome `independent`, `assisted`, `partial`,
`failed`, `blocked`, or `not_run`. Log concrete behavior before interpretation.
Use `assistance=none`, `hint`, or `intervention`. Add active seconds and provider
wait seconds separately; leave unknown measurements blank.

Ask:

> What was most confusing? What would you use instead for your next trip?
> Was anything shown here misleading?

If appropriate, ask permission for one follow-up invitation. Returning voluntarily
for an actual second task is evidence; saying "yes, I would use this" is not.

With permission, remove only this session's synthetic plans, downloaded exports,
and notes from the test profile after recording anonymized outcomes. Do not clear
a participant's real browser data. Stop and log a blocker if anything deletes
saved work unexpectedly or presents invented information as verified.
