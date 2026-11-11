"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight, CalendarBlank, Compass, MapPin, PaperPlaneTilt, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { planTrip } from "../lib/api";
import { DESTINATION_CURRENCIES, requestSchema, type TripPlan, type TripRequest } from "../lib/trip";
import { BentoShowcase, LandingDetails, LandingHero, SampleWorkspace } from "./travel-showcase";
import { TripLibrary, TripWorkspace } from "./trip-workspace";

const AIRPORTS = [
  "Mumbai (BOM)", "Delhi (DEL)", "Hyderabad (HYD)", "Bengaluru (BLR)", "Chennai (MAA)", "Kolkata (CCU)",
  "Dubai (DXB)", "New York (JFK)", "London (LHR)", "Paris (CDG)", "Tokyo (HND)", "Singapore (SIN)",
];
const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function TravelTagline() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const words = ref.current?.querySelectorAll("span");
    if (!words) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      words.forEach(word => word.classList.add("revealed"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -12% 0px" });
    words.forEach(word => observer.observe(word));
    return () => observer.disconnect();
  }, []);
  return (
    <p ref={ref} className="heading-3 travel-tagline">
      {"Less time planning.".split(" ").map((word, i) => <span key={word} style={{ transitionDelay: `${i * 60}ms` }}>{word} </span>)}<br />
      {"More room for discovery.".split(" ").map((word, i) => <span key={word} style={{ transitionDelay: `${(i + 3) * 60}ms` }}>{word} </span>)}
    </p>
  );
}

function LoadingPreview() {
  return (
    <section className="loading-preview panel" aria-label="Preparing your travel plan" aria-busy="true">
      <div className="eyebrow caption-3"><Sparkle size={16} /> Planning in progress</div>
      <h2 className="heading-5">Your next chapter is taking shape</h2>
      <p className="body-6 muted" role="status">Checking connected providers and organizing a draft. This can take around a minute. You can cancel without losing the open plan.</p>
      <div className="skeleton skeleton-title" />
      {[0, 1, 2].map(i => <div className="skeleton-card" key={i} aria-hidden="true"><div className="skeleton skeleton-label" /><div className="skeleton" /><div className="skeleton skeleton-short" /></div>)}
    </section>
  );
}

type PlannerForm = Omit<TripRequest, "origin" | "destination"> & { origin: string; destination: string };

function initialForm(): PlannerForm {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3);
  return { origin: "", destination: "", start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), max_price: 50000, currency: "INR", adults: 1 };
}

function extractCode(text: string) {
  const normalized = text.trim();
  const match = normalized.match(/\(([A-Za-z]{3})\)$/);
  if (match) return match[1].toUpperCase();
  const airport = AIRPORTS.find(airport => airport.split(" (")[0].toLowerCase() === normalized.toLowerCase());
  return airport ? airport.slice(-4, -1) : normalized.toUpperCase();
}

export default function TravelDashboard() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState("");
  const [pendingRequest, setPendingRequest] = useState<TripRequest | null>(null);
  const [formData, setFormData] = useState(initialForm);
  const [currencyNotice, setCurrencyNotice] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  const generate = async (request: TripRequest) => {
    if (activeRequest.current) return;
    setPendingRequest(null); setLoading(true); setError("");
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 110_000);
    try {
      const generated = await planTrip(request, controller.signal);
      if (!controller.signal.aborted) setPlan(generated);
    } catch (error) {
      setError(controller.signal.aborted
        ? controller.signal.reason === "timeout" ? "Planning took too long. Your open plan is unchanged; try again." : "Planning cancelled. Your open plan is unchanged."
        : error instanceof Error ? error.message : "The backend could not be reached. Check the connection and try again.");
    } finally {
      window.clearTimeout(timeout);
      activeRequest.current = null;
      setLoading(false);
    }
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const parsed = requestSchema.safeParse({ ...formData, origin: extractCode(formData.origin), destination: extractCode(formData.destination) });
    if (!parsed.success) { setError("Choose different supported airports, 1 to 6 adults, a positive budget in INR or USD, and a return 1 to 14 nights after departure."); return; }
    if (parsed.data.start_date < new Date().toISOString().slice(0, 10)) { setError("Departure must be today or later (UTC)."); return; }
    if (plan) { setPendingRequest(parsed.data); return; }
    void generate(parsed.data);
  };
  const updatePlan = (updated: TripPlan) => setPlan({ ...updated, updated_at: new Date().toISOString() });
  const openPlan = (opened: TripPlan) => {
    activeRequest.current?.abort();
    setPendingRequest(null); setError(""); setCurrencyNotice(""); setPlan(opened);
    setFormData({ ...opened.request });
  };

  return (
    <div className="travel-app">
      <a className="skip-link button-sm" href="#planner">Skip to trip planner</a>
      <header className="site-header no-print"><nav className="navigation" aria-label="Main navigation">
        <a href="#planner" className="brand" aria-label="AI Travel Planner home"><Image src="/logo.svg" alt="" width={40} height={40} /><span className="title-3">AI Travel <span className="brand-secondary">Planner</span></span></a>
        <a href="#planner" className="nav-current button-sm" aria-current="page"><Compass size={16} />Trip planner</a>
      </nav></header>
      <main id="main-content" className="page-shell">
        <LandingHero /><BentoShowcase />
        <div className="showcase-heading workspace-section-heading no-print"><div><p className="eyebrow caption-3"><Compass size={16} />The journey workspace</p><h2 className="heading-3">Your ideas, with a little direction.</h2></div><span className="caption-2 muted">Local-first alpha · Save, edit, and share your own plan.</span></div>
        <div className="workspace">
          <aside className="planner-sidebar no-print" id="planner" aria-labelledby="planner-heading">
            <form onSubmit={handleSearch} className="panel planner-form">
              <div className="form-heading"><div className="icon-tile"><PaperPlaneTilt size={24} weight="duotone" /></div><div><h2 id="planner-heading" className="heading-6">Where are we headed?</h2><p className="caption-2 muted">Start with the details. We&apos;ll connect the dots.</p></div></div>
              <p className="planner-scope caption-5 muted">1 to 6 adults · One shared room · 1 to 14 nights.<span>Choose from the 12 supported airports below. Confirm the room can accommodate your group.</span></p>
              <datalist id="airport-list">{AIRPORTS.map(airport => <option key={airport} value={airport} />)}</datalist>
              <div className="route-fields">
                <div className="field"><label className="title-4" htmlFor="origin">Flying from</label><div className="input-wrap"><MapPin size={18} /><input id="origin" name="origin" type="text" list="airport-list" placeholder="Mumbai (BOM)" value={formData.origin} onChange={event => setFormData({ ...formData, origin: event.target.value })} required disabled={loading} className="body-5" /></div></div>
                <div className="field"><label className="title-4" htmlFor="destination">Going to</label><div className="input-wrap"><Compass size={18} /><input id="destination" name="destination" type="text" list="airport-list" placeholder="Delhi (DEL)" value={formData.destination} onChange={event => setFormData({ ...formData, destination: event.target.value })} required disabled={loading} className="body-5" /></div></div>
              </div>
              <div className="date-fields">
                <div className="field"><label className="title-4" htmlFor="departure">Departure</label><div className="input-wrap"><CalendarBlank size={18} /><input id="departure" name="start_date" type="date" min={hydrated ? new Date().toISOString().slice(0, 10) : undefined} value={hydrated ? formData.start_date : ""} onChange={event => setFormData({ ...formData, start_date: event.target.value })} required disabled={loading} className="body-5" /></div></div>
                <div className="field"><label className="title-4" htmlFor="return">Return</label><div className="input-wrap"><CalendarBlank size={18} /><input id="return" name="end_date" type="date" min={hydrated ? formData.start_date : undefined} value={hydrated ? formData.end_date : ""} onChange={event => setFormData({ ...formData, end_date: event.target.value })} required disabled={loading} className="body-5" /></div></div>
              </div>
              <div className="activity-editor-row">
                <div className="field"><label className="title-4" htmlFor="adults">Adults</label><select id="adults" name="adults" className="alpha-input body-5" value={formData.adults} disabled={loading} onChange={event => setFormData({ ...formData, adults: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count} {count === 1 ? "adult" : "adults"}</option>)}</select></div>
                <div className="field"><label className="title-4" htmlFor="currency">Budget currency</label><select id="currency" name="currency" className="alpha-input body-5" value={formData.currency} disabled={loading} onChange={event => {
                  const currency = event.target.value as TripRequest["currency"];
                  setFormData({ ...formData, currency, max_price: 0 });
                  setCurrencyNotice(`Budget cleared. Enter a new amount in ${currency}; changing currency does not convert the old amount.`);
                }}><option value="INR">INR · Rupee</option><option value="USD">USD · Dollar</option></select></div>
              </div>
              <div className="field"><label className="title-4" htmlFor="budget">Trip budget<span className="caption-2 muted">{formData.currency} · whole group</span></label><div className="input-wrap"><span className="caption-3">{formData.currency}</span><input id="budget" name="max_price" type="number" step="0.01" min="0.01" max={formData.currency === "INR" ? 100000000 : 1000000} placeholder="Enter group budget" value={formData.max_price || ""} onChange={event => setFormData({ ...formData, max_price: Number(event.target.value) })} required disabled={loading} className="body-5" /></div>
                {currencyNotice && <p className="caption-2 muted" role="status">{currencyNotice}</p>}
                <p className="caption-5 muted">Quotes and estimates use {formData.currency}. {DESTINATION_CURRENCIES[extractCode(formData.destination)] ? `Destination comparison: ${DESTINATION_CURRENCIES[extractCode(formData.destination)]}.` : "Choose a destination to set the comparison currency."} Reference conversion uses Frankfurter; card fees and future rates may differ.</p>
              </div>
              <div className="request-actions"><button className="primary-button button-md" type="submit" disabled={loading}><span>{loading ? "Building your plan" : "Plan my trip"}</span><ArrowRight size={20} /></button>{loading && <button className="secondary-button button-sm" type="button" onClick={() => activeRequest.current?.abort()}>Cancel planning</button>}</div>
              <p className="form-footnote caption-5"><Sparkle size={14} />Unknown costs stay unknown, never invented.</p>
              {pendingRequest && <div className="inline-confirm" role="group" aria-label="Replace open draft"><p className="body-6">A new plan will replace the open draft. Save or export it first if you need to keep it.</p><button className="secondary-button button-sm" type="button" onClick={() => void generate(pendingRequest)}>Replace with new plan</button><button className="secondary-button button-sm" type="button" onClick={() => setPendingRequest(null)}>Keep current draft</button></div>}
              {error && <div className="error-message body-6" role="alert"><WarningCircle size={20} /><p>{error}</p></div>}
            </form>
            <TripLibrary plan={plan} onLoad={openPlan} dirty={!!plan} />
          </aside>
          <div className="workspace-content" aria-live="polite">
            {loading ? <LoadingPreview /> : plan ? <TripWorkspace key={plan.id} plan={plan} onChange={updatePlan} /> : <SampleWorkspace onPrint={() => window.print()} />}
          </div>
        </div>
        <section className="tagline-section no-print" aria-label="Less planning, more discovery"><p className="eyebrow caption-3">Make space for the good parts</p><TravelTagline /></section>
        <LandingDetails />
      </main>
      <footer className="site-footer page-shell caption-5 no-print"><span>AI Travel Planner · A little direction. A world of possibilities.</span><div className="footer-links"><a href="#privacy-note">Your trip data</a><a href="#planning-note">Before booking</a><a href="#planner">Back to planner</a></div></footer>
    </div>
  );
}
