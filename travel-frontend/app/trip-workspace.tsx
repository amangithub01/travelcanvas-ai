"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import {
  ArrowDown, ArrowUp, Check, DownloadSimple, FloppyDisk, LinkSimple,
  MapPin, PencilSimple, Plus, Printer, Trash, UploadSimple,
} from "@phosphor-icons/react";
import {
  calculateBudget, convertAmount, formatMoney, ESTIMATE_KEYS, MAX_IMPORT_BYTES, moveActivity, parseTripFile,
  readTrips, scheduleWarnings, STORAGE_KEY, writeTrip,
  type Activity, type Source, type TripPlan,
} from "../lib/trip";

function SourceLink({ source }: { source?: Source }) {
  if (!source) return <span className="caption-5 muted">Source unavailable</span>;
  return (
    <span className="source-evidence caption-5">
      {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer"><LinkSimple size={14} />{source.provider}</a> : <span>{source.provider}</span>}
      <span>Retrieved {new Date(source.retrieved_at).toLocaleString()}</span>
    </span>
  );
}

function DurationInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const valid = text === "" || (Number.isInteger(Number(text)) && Number(text) >= 5 && Number(text) <= 1440);
  return <input className="alpha-input body-5" type="number" min={5} max={1440} value={text} placeholder="Unknown" aria-invalid={!valid}
    onChange={event => {
      const next = event.target.value;
      setText(next);
      if (next === "") onChange(null);
      else if (Number.isInteger(Number(next)) && Number(next) >= 5 && Number(next) <= 1440) onChange(Number(next));
    }}
    onBlur={() => { if (!valid) setText(value === null ? "" : String(value)); }} />;
}

export function TripWorkspace({ plan, onChange }: { plan: TripPlan; onChange: (plan: TripPlan) => void }) {
  const [editing, setEditing] = useState(false);
  const budget = calculateBudget(plan);
  const currency = plan.request.currency;
  const money = (value: number) => formatMoney(value, currency);
  const converted = (value: number) => {
    const result = convertAmount(value, plan.exchange);
    return result === null ? "Unavailable" : formatMoney(result, plan.exchange.quote);
  };
  const destinationEstimates = ["meals", "transport", "activities"] as const;
  const destinationSubtotal = destinationEstimates.reduce((sum, key) => sum + Math.round((plan.estimates[key] ?? 0) * 100), 0) / 100;
  const destinationUnknown = destinationEstimates.filter(key => plan.estimates[key] === null).length;
  const warnings = [...plan.warnings, ...scheduleWarnings(plan)];
  const updateActivity = (id: string, patch: Partial<Activity>) => {
    onChange({
      ...plan, days: plan.days.map(day => ({
        ...day, activities: day.activities.map(activity => activity.id === id
          ? { ...activity, ...patch, ...("title" in patch || "notes" in patch ? { origin: "personal" as const, source_id: null } : {}) }
          : activity),
      })),
    });
  };
  const removeActivity = (id: string) => onChange({
    ...plan, days: plan.days.map(day => ({ ...day, activities: day.activities.filter(activity => activity.id !== id) })),
  });
  const addActivity = (dayId: string) => onChange({
    ...plan, days: plan.days.map(day => day.id === dayId ? {
      ...day, activities: [...day.activities, { id: crypto.randomUUID(), title: "My next stop", notes: "", time: null, duration_minutes: null, source_id: null, origin: "personal" as const }],
    } : day),
  });

  return (
    <section className="results alpha-results" aria-labelledby="results-heading">
      <div className="results-heading">
        <div><p className="eyebrow caption-3"><Check size={16} /> Your editable travel draft</p><h2 className="heading-4" id="results-heading">{plan.title}</h2><p className="caption-2 muted">{plan.request.origin} → {plan.request.destination} · {plan.request.start_date} to {plan.request.end_date}</p></div>
        <div className="workspace-actions no-print">
          <button type="button" className="secondary-button button-sm" aria-pressed={editing} onClick={() => setEditing(!editing)}><PencilSimple size={16} />{editing ? "Finish editing" : "Edit itinerary"}</button>
          <button type="button" className="secondary-button button-sm" onClick={() => window.print()}><Printer size={16} />Save as PDF</button>
        </div>
      </div>
      {editing && <label className="field title-4 no-print">Trip name<input className="alpha-input body-5" maxLength={200} value={plan.title} onChange={event => onChange({ ...plan, title: event.target.value })} /></label>}
      <div className="alpha-disclosure panel caption-2">
        {plan.request.adults} {plan.request.adults === 1 ? "adult" : "adults"} · One shared room · {currency} group budget · Draft timing only. Room occupancy, opening hours, transit times, and availability are not verified. Nothing is booked.
      </div>
      <details className="plan-warnings panel" open={warnings.some(item => item.includes("unavailable") || item.includes("not configured") || item.includes("exceeds"))}>
        <summary className="title-4">Planning notes and missing data ({warnings.length})</summary>
        <ul className="body-6 muted">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
      </details>
      <div className="weather-strip panel">
        <div><p className="caption-3">{plan.weather.kind === "current" ? "Current weather, not your travel-date forecast" : "Weather unavailable"}</p><p className="body-6">{plan.weather.summary}</p><SourceLink source={plan.sources.find(source => source.id === plan.weather.source_id)} /></div>
      </div>
      <section className="budget-workspace panel" aria-labelledby="budget-heading">
        <div className="budget-workspace-heading"><div><p className="eyebrow caption-3">Honest budget accounting</p><h3 className="heading-6" id="budget-heading">{budget.unknown ? "Known subtotal" : "Planned total"}: {money(budget.total)}</h3></div><p className={`title-3 ${budget.remaining < 0 ? "over-budget" : "price"}`}>{budget.remaining < 0 ? `${money(-budget.remaining)} over budget` : `${money(budget.remaining)} unallocated`}</p></div>
        <p className="caption-2 muted">Group limit {money(plan.request.max_price)}. {budget.unknown} unknown categories are excluded from this subtotal, not treated as free. Unallocated funds are not savings.</p>
        <div className="budget-lines">
          {budget.lines.map(line => (
            <div className="budget-line" key={line.key}>
              <div><p className="title-4">{line.label}<span className="caption-5 muted"> · {line.kind}</span></p><p className="caption-5 muted">{line.basis}</p></div>
              {ESTIMATE_KEYS.includes(line.key as typeof ESTIMATE_KEYS[number]) ? (
                <label className="estimate-control no-print"><span className="sr-only">{line.label} whole-trip group estimate in {currency}</span>
                  <input aria-label={`${line.label} estimate in ${currency}`} className="alpha-input body-5" type="number" step="0.01" min="0" max="100000000" placeholder="Unknown" value={plan.estimates[line.key as typeof ESTIMATE_KEYS[number]] ?? ""}
                    onChange={event => {
                      const value = event.target.value === "" ? null : Number(event.target.value);
                      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100_000_000)) return;
                      onChange({ ...plan, estimates: { ...plan.estimates, [line.key]: value } });
                    }} />
                </label>
              ) : <span className="title-4">{line.amount === null ? "Unknown" : money(line.amount)}</span>}
              {ESTIMATE_KEYS.includes(line.key as typeof ESTIMATE_KEYS[number]) && <span className="print-only title-4">{line.amount === null ? "Unknown" : money(line.amount)}</span>}
            </div>
          ))}
        </div>
      </section>
      {plan.exchange.base !== plan.exchange.quote && <section className="currency-comparison panel" aria-labelledby="exchange-heading">
        <p className="eyebrow caption-3">Destination currency · {plan.exchange.quote}</p>
        <h3 id="exchange-heading" className="heading-6">Your budget, in destination currency</h3>
        {plan.exchange.rate === null ? <p className="body-6 muted">Conversion is unavailable. All budget amounts remain in {currency}; no rate was guessed.</p> : <>
          <dl className="conversion-lines body-6">
            <div><dt>Whole-trip budget equivalent</dt><dd>{converted(plan.request.max_price)}</dd></div>
            <div><dt>Known trip subtotal equivalent</dt><dd>{converted(budget.total)}</dd></div>
            <div><dt>{budget.remaining < 0 ? "Over budget equivalent" : "Unallocated equivalent"}</dt><dd>{converted(Math.abs(budget.remaining))}</dd></div>
            <div><dt>Meals, transport and activities estimate</dt><dd>{destinationUnknown === 3 ? "Unknown" : converted(destinationSubtotal)}</dd></div>
          </dl>
          <p className="caption-2 muted">{destinationUnknown} of 3 on-trip estimate categories are unknown and excluded. These estimates do not include flights or stays. Trip equivalents are comparisons, not a forecast of cash you will spend at the destination.</p>
          <p className="caption-5 muted">1 {plan.exchange.base} ≈ {plan.exchange.rate} {plan.exchange.quote} · Reference date {plan.exchange.as_of}. Bank rates, card fees, cash exchange, and rates on your travel dates may differ. Saved rates are snapshots, not automatically refreshed.</p>
          <SourceLink source={plan.sources.find(source => source.id === plan.exchange.source_id)} />
        </>}
      </section>}
      <div className="results-grid">
        <div className="timeline">
          {plan.days.map((day, dayIndex) => (
            <article key={day.id} className="day-card panel">
              <p className="eyebrow caption-3">Day {dayIndex + 1} · {day.date}</p>
              <h3 className="heading-6">{day.title}</h3>
              {day.activities.length === 0 && <p className="body-6 muted activity-empty">Room for your next discovery. No source-backed stops were assigned to this day.</p>}
              <ol className="real-activity-list">
                {day.activities.map((activity, index) => (
                  <li key={activity.id} className="real-activity">
                    <p className="caption-3 muted">{activity.time || "Time not set"}{activity.duration_minutes ? ` · ${activity.duration_minutes} min` : ""}</p>
                    {editing ? <div className="activity-editor no-print">
                      <label className="field caption-3">Activity name<input className="alpha-input body-5" maxLength={200} value={activity.title} onChange={event => updateActivity(activity.id, { title: event.target.value })} /></label>
                      <label className="field caption-3">Notes<textarea className="alpha-input body-6" maxLength={2000} value={activity.notes} onChange={event => updateActivity(activity.id, { notes: event.target.value })} /></label>
                      <div className="activity-editor-row">
                        <label className="field caption-3">Start time<input className="alpha-input body-5" type="time" value={activity.time || ""} onChange={event => updateActivity(activity.id, { time: event.target.value || null })} /></label>
                        <label className="field caption-3">Duration (5–1440 min)<DurationInput value={activity.duration_minutes} onChange={value => updateActivity(activity.id, { duration_minutes: value })} /></label>
                      </div>
                      <div className="activity-editor-row">
                        <label className="field caption-3">Move to day<select className="alpha-input body-5" value={day.id} onChange={event => onChange(moveActivity(plan, activity.id, event.target.value))}>{plan.days.map((target, i) => <option disabled={target.id !== day.id && target.activities.length >= 20} key={target.id} value={target.id}>Day {i + 1}</option>)}</select></label>
                        <div className="activity-order"><button type="button" className="secondary-button" disabled={index === 0} aria-label={`Move ${activity.title} earlier`} onClick={() => onChange(moveActivity(plan, activity.id, day.id, -1))}><ArrowUp size={16} /></button><button type="button" className="secondary-button" disabled={index === day.activities.length - 1} aria-label={`Move ${activity.title} later`} onClick={() => onChange(moveActivity(plan, activity.id, day.id, 1))}><ArrowDown size={16} /></button><button type="button" className="secondary-button" aria-label={`Remove ${activity.title}`} onClick={() => removeActivity(activity.id)}><Trash size={16} /></button></div>
                      </div>
                    </div> : null}
                    <div className={editing ? "print-only" : ""}><h4 className="title-3">{activity.title}</h4>{activity.notes && <p className="body-6 muted">{activity.notes}</p>}</div>
                    <p className="caption-5">{activity.origin === "personal" ? "Your addition or edit · Not provider verified" : "Place retrieved from a provider · Schedule unverified"}</p>
                    {activity.source_id && <SourceLink source={plan.sources.find(source => source.id === activity.source_id)} />}
                    <a className="map-link caption-4" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activity.title} ${activity.notes} ${plan.request.destination}`)}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />Find on map</a>
                  </li>
                ))}
              </ol>
              {editing && <button className="secondary-button button-sm no-print" type="button" disabled={day.activities.length >= 20} onClick={() => addActivity(day.id)}><Plus size={16} />Add activity to day {dayIndex + 1}</button>}
            </article>
          ))}
        </div>
        <aside className="trip-details" aria-label="Source-backed quotes">
          {(["flights", "hotels"] as const).map(kind => (
            <section className="panel detail-card quote-card" key={kind}>
              <h3 className="title-2">{kind === "flights" ? "Flight quotes" : "Stay quotes"}</h3>
              <p className="caption-5 muted">Choose one to include in your budget. Quoted prices are not guaranteed.</p>
              <label className="field caption-3 no-print">Budget selection<select className="alpha-input body-5" aria-label={kind === "flights" ? "Selected flight" : "Selected stay"} value={(kind === "flights" ? plan.selected_flight_id : plan.selected_hotel_id) || ""} onChange={event => onChange({ ...plan, [kind === "flights" ? "selected_flight_id" : "selected_hotel_id"]: event.target.value || null })}><option value="">Not selected · Unknown cost</option>{plan[kind].map(quote => <option key={quote.id} value={quote.id}>{quote.name}{quote.price !== null ? ` · ${money(quote.price)}` : " · Price unknown"}</option>)}</select></label>
              {plan[kind].length === 0 && <p className="body-6 muted detail-empty">No quotes available. Check the planning notes; no sample prices have been substituted.</p>}
              {plan[kind].map(quote => {
                const selected = (kind === "flights" ? plan.selected_flight_id : plan.selected_hotel_id) === quote.id;
                return <article className={`flight-option ${selected ? "selected-quote" : ""}`} key={quote.id}>
                  <div className="option-heading"><h4 className="title-4">{quote.name}</h4><span className="title-3 price">{quote.price === null ? "Unknown" : money(quote.price)}</span></div>
                  {selected && <span className="badge caption-4">Included in budget</span>}
                  <p className="caption-5 muted">{quote.price_basis}</p>
                  {kind === "flights" && <p className="caption-5">{quote.departure || "Departure not supplied"} → {quote.arrival || "Arrival not supplied"}</p>}
                  {quote.rating != null && <p className="caption-5">Provider rating {quote.rating} / 5</p>}
                  <SourceLink source={quote.source} />
                </article>;
              })}
            </section>
          ))}
        </aside>
      </div>
    </section>
  );
}

const storageEvent = "travel-trips-changed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(storageEvent, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(storageEvent, callback); };
}
function snapshot() {
  try { return window.localStorage.getItem(STORAGE_KEY) || ""; } catch { return "!unavailable"; }
}
const serverSnapshot = () => "";

export function TripLibrary({ plan, onLoad, dirty }: { plan: TripPlan | null; onLoad: (plan: TripPlan) => void; dirty: boolean }) {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const library = useMemo(() => {
    try {
      if (raw === "!unavailable") throw new Error("Browser storage is blocked. You can still export your current plan.");
      return { trips: readTrips({ getItem: () => raw || null }), error: "" };
    } catch (error) {
      return { trips: [] as TripPlan[], error: error instanceof Error ? error.message : "Saved trips could not be read." };
    }
  }, [raw]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pendingLoad, setPendingLoad] = useState<TripPlan | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isSaved = !!plan && library.trips.some(saved => saved.id === plan.id && saved.updated_at === plan.updated_at);
  useEffect(() => {
    if (!plan || !dirty || isSaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [plan, dirty, isSaved]);
  const report = (operation: () => void) => {
    setError(""); setMessage("");
    try { operation(); } catch (error) {
      setError(error instanceof Error && error.name === "ZodError" ? "The trip has invalid or empty fields. Check the trip and activity names before saving." : error instanceof Error ? error.message : "This action failed. Export your trip to keep a copy.");
    }
  };
  const save = () => report(() => {
    if (!plan) return;
    writeTrip(window.localStorage, plan);
    window.dispatchEvent(new Event(storageEvent));
    setMessage("Trip saved in this browser only. Export a file for a portable backup.");
  });
  const load = (trip: TripPlan) => {
    if (dirty && !isSaved) setPendingLoad(trip);
    else { onLoad(trip); setMessage("Trip opened. Stored quotes have not been refreshed."); }
  };
  const download = () => report(() => {
    if (!plan) return;
    const validated = parseTripFile(JSON.stringify(plan));
    const url = URL.createObjectURL(new Blob([JSON.stringify(validated, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `travel-plan-${plan.request.destination}-${plan.request.start_date}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Trip file exported. It contains your trip details and personal notes; share it only with people you trust.");
  });
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Trip files must be smaller than 2 MB.");
      const imported = parseTripFile(await file.text());
      const stamp = new Date().toISOString();
      load({
        ...imported, id: crypto.randomUUID(), updated_at: stamp,
        warnings: [...imported.warnings.slice(0, 49), "Imported file: prices and source metadata were supplied by the file author, not independently verified or refreshed."],
      });
    } catch {
      setError("Import failed. Choose a valid version 1 or 2 travel JSON file smaller than 2 MB. Existing trips are unchanged.");
    }
  };

  return (
    <section className="trip-library panel no-print" aria-labelledby="library-heading">
      <h3 id="library-heading" className="heading-6">My trips <span className="caption-4 muted">{library.trips.length} / 30</span></h3>
      <p className="caption-2 muted">Local-first alpha. No account or cloud backup. Clearing browser data removes saved trips. Export JSON to share an editable copy; PDF shares a read-only itinerary.</p>
      <div className="library-actions">
        <button type="button" className="secondary-button button-sm" disabled={!plan || !!library.error} onClick={save}><FloppyDisk size={16} />Save trip</button>
        <button type="button" className="secondary-button button-sm" disabled={!plan} onClick={download}><DownloadSimple size={16} />Export JSON</button>
        <button type="button" className="secondary-button button-sm" onClick={() => fileInput.current?.click()}><UploadSimple size={16} />Import JSON</button>
        <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Import trip JSON file" onChange={importFile} />
      </div>
      {plan && <p className="caption-5 muted">{library.trips.some(trip => trip.id === plan.id && trip.updated_at === plan.updated_at) ? "Current edits saved in this browser." : "Current plan has unsaved changes."}</p>}
      {message && <p className="caption-2 library-status" role="status">{message}</p>}
      {(error || library.error) && <p className="error-message body-6" role="alert">{error || library.error}</p>}
      {pendingLoad && <div className="inline-confirm" role="group" aria-label="Unsaved edits"><p className="body-6">Open another trip and discard unsaved edits?</p><button type="button" className="secondary-button button-sm" onClick={() => { onLoad(pendingLoad); setPendingLoad(null); }}>Open trip</button><button type="button" className="secondary-button button-sm" onClick={() => setPendingLoad(null)}>Keep editing</button></div>}
      {library.trips.length === 0 && !library.error && <p className="caption-2 muted">Plan a trip or import a trip file to start your library. The sample showcase is never saved as a real trip.</p>}
      <ul className="saved-trip-list">{library.trips.map(trip => <li key={trip.id}>
        <div><button type="button" className="saved-trip-open title-4" onClick={() => load(trip)}>{trip.title}</button><p className="caption-5 muted">{trip.request.start_date} · {trip.request.origin} → {trip.request.destination} · {trip.request.adults} adult(s) · {trip.request.currency}</p></div>
        <button type="button" className="secondary-button" aria-label={`Delete saved ${trip.title}`} onClick={() => setDeleteId(trip.id)}><Trash size={16} /></button>
        {deleteId === trip.id && <div className="inline-confirm"><p className="caption-2">Delete this browser copy? Export it first if you need a backup.</p><button className="secondary-button button-sm" type="button" onClick={() => report(() => { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library.trips.filter(item => item.id !== trip.id))); window.dispatchEvent(new Event(storageEvent)); setDeleteId(null); setMessage("Saved browser copy deleted. An open plan stays available until you leave."); })}>Delete copy</button><button className="secondary-button button-sm" type="button" onClick={() => setDeleteId(null)}>Keep trip</button></div>}
      </li>)}</ul>
    </section>
  );
}
