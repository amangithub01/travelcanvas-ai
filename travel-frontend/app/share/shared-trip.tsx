"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cloudConfigured, getCloudClient, readCloudShare } from "../../lib/cloud";
import type { TripPlan } from "../../lib/trip";
import { TripWorkspace } from "../trip-workspace";

export function SharedTrip() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    const load = async () => {
      const current = ++sequence;
      try {
        if (!cloudConfigured) throw new Error("Shared trips are not configured on this installation.");
        const token = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
        const snapshot = await readCloudShare(getCloudClient(), token);
        if (!cancelled && current === sequence) { setPlan(snapshot); setError(""); }
      } catch (error) {
        if (!cancelled && current === sequence) { setPlan(null); setError(error instanceof Error && error.name !== "ZodError" ? error.message : "This snapshot has an unsupported trip format."); }
      }
    };
    void load();
    window.addEventListener("hashchange", load);
    return () => { cancelled = true; window.removeEventListener("hashchange", load); };
  }, []);
  return <main className="page-shell shared-trip">
    <Link className="secondary-button button-sm no-print" href="/">Create your own travel plan</Link>
    <div className="alpha-disclosure panel caption-2">
      Read-only snapshot published by its author. Quotes, notes, timing and source metadata are not independently verified or refreshed. It is not a booking. Anyone holding this link can view it; revocation cannot recall copies already saved.
    </div>
    {error ? <p className="error-message body-6" role="alert">{error}</p>
      : plan ? <TripWorkspace plan={plan} readOnly onChange={() => {}} />
        : <p className="body-6" role="status">Loading shared snapshot…</p>}
  </main>;
}
