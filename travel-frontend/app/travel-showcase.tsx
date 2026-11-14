"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Bed, CalendarBlank, Camera, CheckCircle, Clock,
  CloudSun, Compass, CurrencyDollar, FilePdf, ForkKnife, GlobeHemisphereWest,
  MapPin, PaperPlaneTilt, Pause, Play, Plus, Printer, Sparkle, Star, Wind,
} from "@phosphor-icons/react";

const notifications = [
  { icon: PaperPlaneTilt, title: "Flight shortlist", detail: "BOM → DEL · $142", tone: "teal" },
  { icon: Bed, title: "Boutique stay", detail: "Connaught Place · 4.9 ★", tone: "sand" },
  { icon: Camera, title: "Old Delhi heritage walk", detail: "Day 1 · Clear skies · 26°C", tone: "rose" },
  { icon: CurrencyDollar, title: "Budget optimized", detail: "$1,240 saved in this example", tone: "teal" },
  { icon: Compass, title: "Room for discovery", detail: "3 days · 9 handpicked stops", tone: "sand" },
  { icon: FilePdf, title: "Your plan, ready to go", detail: "Itinerary · Stays · PDF export", tone: "rose" },
];

export function LandingHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pausedByUser = useRef(false);
  const [videoReady, setVideoReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    const syncPlayback = () => {
      if (motion.matches) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        return;
      }
      if (document.hidden || !visible || pausedByUser.current) {
        video.pause();
        return;
      }
      if (!video.getAttribute("src")) video.src = "/hero-aerial.mp4";
      video.playbackRate = 0.65;
      void video.play().catch(() => {});
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    });
    observer.observe(video);
    motion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, []);

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    pausedByUser.current = !video.paused;
    if (pausedByUser.current) video.pause();
    else void video.play().catch(() => {});
  };

  return (
    <section className="orbit-hero no-print" aria-labelledby="page-heading">
      <div className="hero-backdrop" aria-hidden="true">
        <Image className="hero-fallback" src="/hero-landscape.jpg" alt="" fill priority sizes="100vw" unoptimized />
        <video
          ref={videoRef}
          className={`hero-video ${videoReady ? "video-ready" : ""}`}
          autoPlay loop muted playsInline preload="none" poster="/hero-landscape.jpg"
          onCanPlay={() => setVideoReady(true)}
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEmptied={() => setVideoReady(false)}
          onError={() => setVideoReady(false)}
        />
      </div>
      {videoReady && <button type="button" className="video-motion-toggle" onClick={toggleVideo} aria-label={playing ? "Pause background video" : "Play background video"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>}
      <svg className="orbit-art" viewBox="0 0 1320 600" fill="none" aria-hidden="true">
        {[152, 216, 280, 344, 408].map(radius => <circle key={radius} cx="660" cy="272" r={radius} />)}
        <path className="orbit-connector" d="M240 130C360 130 330 250 470 240M180 290C340 290 340 300 458 300M258 440C380 440 350 360 486 350M1080 140C960 140 1000 210 850 240M1150 300C1010 300 990 300 868 300M1060 450C960 450 1000 370 836 350" />
        <circle className="orbit-point" cx="470" cy="240" r="4" />
        <circle className="orbit-point" cx="850" cy="240" r="4" />
        <circle className="orbit-point" cx="486" cy="350" r="4" />
        <circle className="orbit-point" cx="836" cy="350" r="4" />
      </svg>
      <div className="hero-copy">
        <p className="warm-pill caption-3"><Sparkle size={14} weight="fill" /> AI-Powered Itinerary Engine</p>
        <h1 id="page-heading" className="heading-1 hero-heading editorial-heading">Your next adventure,<br />beautifully planned.</h1>
        <p className="body-3 hero-description">A flight that fits. A stay you&apos;ll love. A day worth getting up for.<br className="desktop-break" /> Turn your travel ideas into one thoughtfully connected plan.</p>
        <a href="#planner" className="primary-button button-md hero-cta">Plan my trip <ArrowRight size={18} /></a>
        <p className="caption-2 hero-proof"><CheckCircle size={16} /> Explore the preview. Nothing is booked automatically.</p>
      </div>
      <div className="floating-notifications" aria-label="Illustrative travel planning notifications">
        {notifications.map(({ icon: Icon, title, detail, tone }, index) => (
          <article className={`floating-card floating-card-${index + 1}`} key={title}>
            <div className={`notification-icon tone-${tone}`}><Icon size={20} weight="duotone" /></div>
            <div><div className="notification-heading"><h2 className="title-4">{title}</h2><span className="caption-5 muted">Sample</span></div><p className="caption-2 muted">{detail}</p></div>
          </article>
        ))}
      </div>
      <p className="hero-demo-note caption-5">Illustrative preview · Sample prices, ratings, weather, and savings are not live quotes.</p>
    </section>
  );
}

const budgetCategories = [
  { name: "Flights", amount: 426, color: "#176b60", icon: PaperPlaneTilt, detail: "Outbound, return, and a little room for baggage." },
  { name: "Stays", amount: 924, color: "#8aa98d", icon: Bed, detail: "A boutique base close to the places you want to explore." },
  { name: "Daily activities", amount: 800, color: "#d6a576", icon: Camera, detail: "Local meals, museum visits, transit, and discoveries." },
];

export function BentoShowcase() {
  const [category, setCategory] = useState(0);
  const [telemetry, setTelemetry] = useState<"route" | "weather">("route");
  const selected = budgetCategories[category];

  return (
    <section className="bento-section no-print" id="showcase" aria-labelledby="showcase-heading">
      <div className="showcase-heading">
        <div><p className="eyebrow caption-3"><GlobeHemisphereWest size={16} /> The travel control room</p><h2 id="showcase-heading" className="heading-3">Big picture. Every little detail.</h2></div>
        <span className="sample-label caption-4"><span className="status-dot" /> Interactive product preview</span>
      </div>
      <div className="bento-grid">
        <article className="budget-bento bento-card">
          <div className="bento-card-header"><span className="caption-3"><CurrencyDollar size={16} /> A plan that adds up</span><span className="glass-badge caption-5">Sample budget</span></div>
          <div className="budget-glass">
            <div className="budget-total"><div><p className="caption-2 muted">Total trip budget</p><h3 className="heading-2">$5,000<span className="caption-4 muted"> USD</span></h3></div><div className="budget-symbol"><CurrencyDollar size={28} weight="duotone" /></div></div>
            <div className="allocation-label"><span className="title-4">Allocated: $2,150</span><span className="caption-4 muted">43% of your budget</span></div>
            <div className="budget-progress" role="progressbar" aria-label="Sample trip budget allocated" aria-valuenow={2150} aria-valuemin={0} aria-valuemax={5000}>
              {budgetCategories.map(item => <span key={item.name} style={{ width: `${item.amount / 5000 * 100}%`, backgroundColor: item.color }} />)}
            </div>
            <div className="budget-selectors" aria-label="Explore sample budget categories">
              {budgetCategories.map((item, i) => (
                <button type="button" aria-pressed={category === i} onClick={() => setCategory(i)} className="budget-selector caption-4" key={item.name}>
                  <span className="legend-dot" style={{ backgroundColor: item.color }} />{item.name}
                </button>
              ))}
            </div>
            <div className="budget-detail" aria-live="polite"><div className="icon-tile"><selected.icon size={20} /></div><div><p className="title-4">{selected.name} · ${selected.amount.toLocaleString("en-US")}</p><p className="caption-2 muted">{selected.detail}</p></div></div>
            <div className="budget-remaining caption-4"><CheckCircle size={16} /><span>$2,850 left for the unexpected.</span></div>
          </div>
          <p className="bento-footnote caption-5">Illustrative allocation, not a price estimate or a savings guarantee.</p>
        </article>

        <article className="route-bento bento-card">
          <div className="bento-card-header"><span className="caption-3"><Compass size={16} /> Route &amp; weather telemetry</span><span className="glass-badge caption-5">Sample data</span></div>
          <div className="telemetry-switch" aria-label="Explore route and weather">
            <button className="button-sm" type="button" aria-pressed={telemetry === "route"} onClick={() => setTelemetry("route")}><PaperPlaneTilt size={16} /> Flight path</button>
            <button className="button-sm" type="button" aria-pressed={telemetry === "weather"} onClick={() => setTelemetry("weather")}><CloudSun size={16} /> Weather</button>
          </div>
          <div className="route-visual">
            <svg viewBox="0 0 600 240" fill="none" aria-hidden="true">
              <g className="map-contours"><path d="M70 200L130 180 156 118 222 105 240 43 294 30 340 62 344 120 400 134 432 175 526 186" /><path d="M40 150L102 118 130 64 188 65 232 15M220 236L250 186 292 166 338 184 380 228M400 34L448 62 480 116 556 125" /></g>
              <path className="route-arc-shadow" d="M125 180Q264 -35 447 76" />
              <path className="route-arc" d="M125 180Q264 -35 447 76" />
              <path className="route-arc-secondary" d="M125 180Q350 204 447 76" />
              <circle className="map-halo" cx="125" cy="180" r="18" /><circle className="map-halo" cx="447" cy="76" r="18" />
              <circle className="map-stop" cx="125" cy="180" r="5" /><circle className="map-stop" cx="447" cy="76" r="5" />
            </svg>
            <span className="map-city map-city-origin caption-3">BOM <span className="caption-5">Mumbai</span></span>
            <span className="map-city map-city-destination caption-3">DEL <span className="caption-5">New Delhi</span></span>
            <span className="map-plane"><PaperPlaneTilt size={24} weight="fill" /></span>
            <div className="weather-float caption-3"><CloudSun size={20} weight="duotone" /> 26°C <span className="caption-5">Clear skies</span></div>
          </div>
          <div className="telemetry-readout" aria-live="polite">
            {telemetry === "route" ? <><div><p className="caption-5 muted">Flight path</p><p className="title-3">BOM → DEL</p></div><div><p className="caption-5 muted">Sample duration</p><p className="title-3">2h 15m</p></div><div><p className="caption-5 muted">Departure</p><p className="title-3">06:15 AM</p></div></> :
              <><div><p className="caption-5 muted">Temperature</p><p className="title-3">26°C</p></div><div><p className="caption-5 muted">Wind speed</p><p className="title-3">12 km/h</p></div><div><p className="caption-5 muted">Conditions</p><p className="title-3">Clear skies</p></div></>}
          </div>
          <div className="telemetry-footer"><span className="caption-4"><Wind size={16} /> Wind 12 km/h</span><a className="pdf-ready caption-4" href="#planner"><FilePdf size={16} /> PDF export ready <ArrowRight size={14} /></a></div>
        </article>
      </div>
    </section>
  );
}

const sampleDays = [
  {
    day: 1, title: "Old Delhi, a little closer", date: "December 10", theme: "Heritage & local flavors", icon: Camera,
    activities: [
      { time: "09:30", name: "Old Delhi heritage walk", detail: "Explore the lanes around the Red Fort and Chandni Chowk.", tag: "Walk + rickshaw" },
      { time: "13:30", name: "A taste of Chandni Chowk", detail: "Make time for a local lunch and a fresh lime soda.", tag: "Food discovery" },
      { time: "17:00", name: "Jama Masjid at golden hour", detail: "Slow down for the courtyard views and neighborhood streets.", tag: "Architecture" },
    ],
  },
  {
    day: 2, title: "Gardens, galleries, good coffee", date: "December 11", theme: "Culture & slower moments", icon: ForkKnife,
    activities: [
      { time: "09:00", name: "Humayun's Tomb", detail: "Start early for the gardens and sandstone architecture.", tag: "Heritage stop" },
      { time: "12:30", name: "A pause in Lodhi Garden", detail: "Take a shaded walk, then find a relaxed spot for lunch.", tag: "Outdoor escape" },
      { time: "18:15", name: "An evening in Khan Market", detail: "Browse independent shops and settle into a neighborhood cafe.", tag: "Local favorites" },
    ],
  },
  {
    day: 3, title: "One more story to take home", date: "December 12", theme: "Design & everyday discoveries", icon: Compass,
    activities: [
      { time: "09:30", name: "Qutub Minar & its surroundings", detail: "Leave room to explore the monuments beyond the main tower.", tag: "History" },
      { time: "13:00", name: "Crafts & lunch at Dilli Haat", detail: "Look for regional craft stalls and pick a new dish to try.", tag: "Craft + food" },
      { time: "17:45", name: "Connaught Place, one last loop", detail: "Finish with a gentle walk through the colonnades.", tag: "City wandering" },
    ],
  },
];

const dayPhotos = [
  { src: "/delhi-old-city.jpg", alt: "A busy street in Chandni Chowk, Old Delhi" },
  { src: "/delhi-humayun.jpg", alt: "Humayun's Tomb and its gardens in New Delhi" },
  { src: "/delhi-qutub.jpg", alt: "The Qutub Minar tower in New Delhi" },
];

export function SampleWorkspace({ onPrint }: { onPrint: () => void }) {
  const [day, setDay] = useState<number | null>(null);

  return (
    <section className="sample-workspace results" aria-labelledby="sample-results-heading">
      <div className="results-heading">
        <div><p className="eyebrow caption-3"><Sparkle size={16} /> A preview of what&apos;s possible</p><h2 id="sample-results-heading" className="heading-4">DEL itinerary <span className="sample-label caption-4">Sample plan</span></h2></div>
        <button type="button" onClick={onPrint} className="secondary-button button-sm no-print"><Printer size={18} /> Save as PDF</button>
      </div>
      <div className="sample-summary panel">
        <div><CalendarBlank size={16} /><span className="caption-4">Dec 10–12 · 3 days</span></div>
        <div><CloudSun size={18} /><span className="caption-4">26°C · Clear skies</span></div>
        <div><MapPin size={16} /><span className="caption-4">9 discoveries</span></div>
      </div>
      <p className="sample-disclaimer caption-5 muted">Illustrative itinerary with sample times, prices, ratings, and weather. No bookings have been made. Submit your details for your own plan.</p>
      <div className="sample-day-filters no-print" aria-label="Filter sample itinerary days">
        <button type="button" className="button-sm" aria-pressed={day === null} onClick={() => setDay(null)}>All days</button>
        {sampleDays.map(item => <button type="button" className="button-sm" key={item.day} aria-pressed={day === item.day} onClick={() => setDay(item.day)}>Day {item.day}</button>)}
      </div>
      <div className="results-grid">
        <div className="sample-days">
          {sampleDays.map(item => (
            <article className={`sample-day panel ${day !== null && day !== item.day ? "sample-day-hidden" : ""}`} key={item.day}>
              <div className={`sample-day-photo day-photo-${item.day}`}><Image src={dayPhotos[item.day - 1].src} alt={dayPhotos[item.day - 1].alt} fill sizes="(max-width: 600px) 100vw, 600px" unoptimized /></div>
              <div className="sample-day-heading"><div className="icon-tile"><item.icon size={20} weight="duotone" /></div><div><p className="eyebrow caption-3">Day {item.day} <span className="muted">· {item.date}</span></p><h3 className="heading-6">{item.title}</h3></div></div>
              <p className="sample-day-theme caption-5 muted">{item.theme}</p>
              <ol className="activity-list">
                {item.activities.map(activity => <li key={activity.time}><span className="time-badge caption-4"><Clock size={12} />{activity.time}</span><div><h4 className="title-4">{activity.name}</h4><p className="caption-2 muted">{activity.detail}</p><span className="activity-tag caption-5">{activity.tag}</span></div></li>)}
              </ol>
            </article>
          ))}
        </div>
        <aside className="trip-details sample-trip-details" aria-label="Sample flights and hotel">
          <article className="flight-ticket panel">
            <div className="ticket-header"><span className="title-4"><PaperPlaneTilt size={18} /> Your flight</span><span className="caption-5 muted">Sample ticket</span></div>
            <div className="ticket-route"><div><p className="heading-4">BOM</p><p className="caption-5 muted">Mumbai</p></div><div className="ticket-journey"><PaperPlaneTilt size={20} /><span className="caption-5 muted">2h 15m</span></div><div><p className="heading-4">DEL</p><p className="caption-5 muted">New Delhi</p></div></div>
            <div className="ticket-times caption-4"><span>06:15 AM</span><span>08:30 AM</span></div>
            <div className="ticket-info"><div><p className="caption-5 muted">Cabin</p><p className="title-4">Economy</p></div><div><p className="caption-5 muted">Sample fare</p><p className="title-3 price">$142</p></div></div>
            <div className="ticket-stub"><svg viewBox="0 0 220 32" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 48 }, (_, i) => <rect key={i} x={i * 4.6} y="0" width={i % 3 === 0 ? 3 : 1} height="32" />)}</svg><p className="caption-5 muted">Preview only · Not a boarding pass</p></div>
          </article>
          <article className="sample-hotel panel">
            <div className="sample-hotel-photo">
              <Image src="/boutique-stay.jpg" alt="Illustrative hotel pool, not a photograph of an actual Delhi listing" fill sizes="(max-width: 600px) 100vw, 272px" unoptimized />
              <span className="glass-badge caption-5">Illustrative photograph</span>
            </div>
            <div className="sample-hotel-body"><p className="eyebrow caption-3"><Bed size={16} /> A place to call your own</p><h3 className="heading-6">The Colonnade House</h3><p className="caption-2 muted"><MapPin size={14} /> Connaught Place, New Delhi</p><div className="sample-hotel-rating"><span className="star-rating" aria-label="Sample rating 4.9 out of 5">{[0, 1, 2, 3, 4].map(i => <Star size={12} weight="fill" key={i} />)}<span className="caption-4">4.9</span></span><span className="title-3 price">$308<span className="caption-5 muted"> / night</span></span></div><p className="caption-5 muted">Fictional hotel for this product preview.</p></div>
          </article>
          <div className="sample-transit panel"><div className="icon-tile"><MapPin size={20} /></div><div><h3 className="title-4">A local transit tip</h3><p className="caption-2 muted">Use the Delhi Metro between neighborhoods, then walk the last stretch.</p></div></div>
        </aside>
      </div>
    </section>
  );
}

const questions = [
  { question: "What goes into my travel plan?", answer: "Your starting airport, destination, departure and return dates, 1 to 6 adults sharing one room, and a group budget in INR or USD. The planner brings together an itinerary, current weather, flight options, stays, and local discoveries, with a reference comparison in the destination currency when a rate is available." },
  { question: "Are the showcase prices and bookings real?", answer: "No. The landing page and Delhi preview use illustrative prices, weather, times, ratings, and a fictional hotel. Submit the planner to request results from the connected services." },
  { question: "Does this book flights or hotels for me?", answer: "No bookings or payments are made by this planner. Confirm prices, schedules, availability, and terms directly with the provider before booking.", id: "planning-note" },
  { question: "Can I take my itinerary with me?", answer: "Yes. Choose Save as PDF in the workspace to open your browser's print dialog. Select Save as PDF to keep a copy. The planning form and marketing sections are excluded." },
  { question: "Why might a live search return fewer options?", answer: "Availability and connected services can vary. This local installation also needs its backend and provider API keys configured. If a request fails, the planner shows an inline message so you can try again." },
  { question: "What happens to my trip details?", answer: "Planning sends your trip details to the Python backend and connected providers. Browser saves stay on this device. If cloud accounts are configured, Supabase receives account credentials and trips you explicitly save or publish; signing in does not upload browser trips. Shared snapshot links expose included details to anyone holding the link. Exported JSON and PDFs also include notes, so share carefully.", id: "privacy-note" },
];

export function LandingDetails() {
  return (
    <div className="landing-details no-print">
      <section className="how-it-works" id="how-it-works" aria-labelledby="how-heading">
        <div className="showcase-heading"><div><p className="eyebrow caption-3">From idea to itinerary</p><h2 id="how-heading" className="heading-3">Three steps. One connected journey.</h2></div></div>
        <div className="steps-grid">
          {[
            { icon: Compass, title: "Bring your curiosity", copy: "Pick your route, dates, and budget. Your next chapter starts with five details." },
            { icon: Sparkle, title: "Let the pieces connect", copy: "Explore weather, flights, stays, and daily discoveries in the same workspace." },
            { icon: FilePdf, title: "Make the plan yours", copy: "Review the recommendations, confirm with providers, and save your itinerary as a PDF." },
          ].map((step, i) => <article className="step-card panel" key={step.title}><div className="step-top"><div className="icon-tile"><step.icon size={24} weight="duotone" /></div><span className="caption-3 muted">0{i + 1}</span></div><h3 className="heading-6">{step.title}</h3><p className="body-6 muted">{step.copy}</p></article>)}
        </div>
      </section>
      <section className="faq-section" aria-labelledby="faq-heading">
        <div><p className="eyebrow caption-3">Before you set off</p><h2 id="faq-heading" className="heading-3">A few things<br />worth knowing.</h2><p className="body-6 muted">A useful starting point, not a booking service. You stay in charge of the journey.</p></div>
        <div className="faq-list">{questions.map(item => <details className="faq-item panel" id={item.id} key={item.question}><summary className="title-3">{item.question}<Plus size={18} /></summary><p className="body-6 muted">{item.answer}</p></details>)}</div>
      </section>
      <section className="final-cta panel" aria-labelledby="final-heading">
        <div><p className="eyebrow caption-3"><Sparkle size={16} /> Your next chapter starts here</p><h2 id="final-heading" className="heading-3 editorial-heading">Where will your curiosity take you?</h2><p className="body-6 muted">Explore a plan before you commit to a booking.</p></div>
        <a className="primary-button button-md" href="#planner">Plan my trip <ArrowRight size={18} /></a>
      </section>
    </div>
  );
}
