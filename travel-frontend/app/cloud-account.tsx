"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import {
  cloudConfigured, cloudSnapshot, createCloudShare, deleteCloudTrip, getCloudClient,
  listCloudShares, listCloudTrips, openCloudTrip, revokeCloudShare, saveCloudTrip,
  type CloudShare, type CloudTrip,
} from "../lib/cloud";
import type { TripPlan } from "../lib/trip";

function cloudError(error: unknown) {
  if (error instanceof Error && error.name !== "ZodError") return error.message;
  return "Cloud data is unsupported. Your open draft and browser copies are unchanged.";
}

export function CloudAccount({ plan, onLoad }: { plan: TripPlan | null; onLoad: (plan: TripPlan) => void }) {
  return <section id="cloud-account" className="trip-library account-panel panel no-print" aria-labelledby="cloud-heading">
    <h3 id="cloud-heading" className="heading-6">{process.env.NEXT_PUBLIC_REQUIRE_LOGIN === "true" ? "Your account" : "Optional cloud account"}</h3>
    {!cloudConfigured ? <p className="caption-2 muted">Cloud accounts are not configured on this installation. Browser saves, JSON exports, and planning still work without an account. Setup instructions are in the project README.</p>
      : <AccountContent plan={plan} onLoad={onLoad} />}
  </section>;
}

function AccountContent({ plan, onLoad }: { plan: TripPlan | null; onLoad: (plan: TripPlan) => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup" | "reset" | "recovery">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const api = getCloudClient();
    const { data: { subscription } } = api.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null); setReady(true); setPassword(""); setMessage(""); setError("");
      if (event === "PASSWORD_RECOVERY") setMode("recovery");
      if (event === "SIGNED_OUT") setMode("signin");
    });
    return () => subscription.unsubscribe();
  }, []);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const api = getCloudClient();
      const result = mode === "signin" ? await api.auth.signInWithPassword({ email, password })
        : mode === "signup" ? await api.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
          : mode === "reset" ? await api.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
            : await api.auth.updateUser({ password });
      if (result.error) {
        const code = result.error.code;
        throw new Error(code === "invalid_credentials" ? "Email or password is incorrect."
          : code === "email_not_confirmed" ? "Confirm your email before signing in."
            : code === "weak_password" ? "Choose a stronger password that meets this project's password rules."
              : "Account action failed. Check your connection, email confirmation, and Supabase email settings; wait before retrying.");
      }
      setPassword("");
      setMessage(mode === "signup" ? "If signup is available for this address, check your email to confirm it. Existing browser trips have not been uploaded."
        : mode === "reset" ? "If this address has an account, a password-reset email has been requested."
          : mode === "recovery" ? "Password updated." : "Signed in. Nothing uploads until you choose a cloud action.");
      if (mode === "recovery") setMode("signin");
    } catch (error) { setError(cloudError(error)); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true); setError("");
    try {
      const { error } = await getCloudClient().auth.signOut({ scope: "local" });
      if (error) throw new Error("Sign-out failed. Check your connection and try again.");
      setMessage("Signed out. The open draft and browser-saved copies remain on this device.");
    } catch (error) { setError(cloudError(error)); }
    finally { setBusy(false); }
  };

  return <>
    <p className="caption-2 muted">Supabase handles account credentials and explicitly saved cloud copies. Signing in does not upload browser trips. Sessions persist on this browser; avoid shared devices.</p>
    {!ready ? <p className="caption-2" role="status">Checking your account session…</p> : user && mode !== "recovery" ? <>
      <p className="caption-2 cloud-identity">Signed in as {user.email}</p>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void signOut()}>Sign out on this device</button>
      <p className="caption-5 muted">Signing out hides your cloud library, but does not erase the open draft or browser copies.</p>
      <CloudLibrary key={user.id} owner={user.id} plan={plan} onLoad={onLoad} />
    </> : <form className="cloud-form" onSubmit={authenticate}>
      <h4 className="title-4">{mode === "signup" ? "Create an account" : mode === "reset" ? "Request password reset" : mode === "recovery" ? "Choose a new password" : "Sign in"}</h4>
      {mode !== "recovery" && <label className="field caption-3">Email<input className="alpha-input body-5" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>}
      {mode !== "reset" && <label className="field caption-3">{mode === "recovery" ? "New password" : "Password"}<input className="alpha-input body-5" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signin" ? 1 : 8} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>}
      <button type="submit" className="secondary-button button-sm" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset email" : mode === "recovery" ? "Update password" : "Sign in"}</button>
      {mode !== "recovery" && <div className="library-actions">
        <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setPassword(""); setError(""); setMessage(""); }}>{mode === "signin" ? "Create account instead" : "Back to sign in"}</button>
        {mode !== "reset" && <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => { setMode("reset"); setPassword(""); setError(""); setMessage(""); }}>Forgot password</button>}
      </div>}
    </form>}
    {message && <p className="caption-2 library-status" role="status">{message}</p>}
    {error && <p className="error-message body-6" role="alert">{error}</p>}
  </>;
}

function CloudLibrary({ owner, plan, onLoad }: { owner: string; plan: TripPlan | null; onLoad: (plan: TripPlan) => void }) {
  const [trips, setTrips] = useState<CloudTrip[]>([]);
  const [shares, setShares] = useState<CloudShare[]>([]);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [moreTrips, setMoreTrips] = useState(false);
  const [moreShares, setMoreShares] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<CloudTrip | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CloudTrip | null>(null);
  const [pendingShare, setPendingShare] = useState<TripPlan | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<CloudShare | null>(null);
  const [newLink, setNewLink] = useState<{ id: string; url: string } | null>(null);
  const active = useRef(true);
  const api = getCloudClient();
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    Promise.all([listCloudTrips(api, owner), listCloudShares(api, owner)]).then(([trips, shares]) => {
      if (!cancelled) { setTrips(trips); setShares(shares); setMoreTrips(trips.length === 100); setMoreShares(shares.length === 100); }
    }).catch(error => { if (!cancelled) setError(cloudError(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; };
  }, [api, owner]);
  const run = async <T,>(work: () => Promise<T>, apply: (result: T) => void) => {
    if (busy || loading) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await work(); if (active.current) apply(result); }
    catch (error) { if (active.current) setError(cloudError(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const refresh = () => run(() => Promise.all([listCloudTrips(api, owner), listCloudShares(api, owner)]), ([trips, shares]) => {
    setTrips(trips); setShares(shares); setMoreTrips(trips.length === 100); setMoreShares(shares.length === 100); setMessage("Cloud lists refreshed. The open draft is unchanged.");
  });
  const open = (trip: CloudTrip) => run(() => openCloudTrip(api, owner, trip.plan_id), row => {
    onLoad(row.plan); setRevisions(current => ({ ...current, [row.plan.id]: row.revision })); setPendingOpen(null);
    setMessage("Cloud trip opened. Quotes and exchange rates are saved snapshots, not refreshed results.");
  });

  return <div className="cloud-form">
    <h4 className="title-4">Private cloud library</h4>
    <p className="caption-5 muted">Cloud copies are separate from browser saves. Save explicitly after editing. Only this account can read private copies. Lists load 100 items at a time; refresh to see changes from other devices.</p>
    <div className="library-actions">
      <button type="button" className="secondary-button button-sm" disabled={busy || loading || !plan} onClick={() => {
        if (plan) void run(() => saveCloudTrip(api, owner, plan, revisions[plan.id] ?? null), trip => {
          setRevisions(current => ({ ...current, [trip.plan_id]: trip.revision }));
          setTrips(current => [trip, ...current.filter(row => row.plan_id !== trip.plan_id)]);
          setMessage("Saved this draft privately to your cloud account. The browser library was not changed.");
        });
      }}>Save to cloud</button>
      <button type="button" className="secondary-button button-sm" disabled={busy || loading} onClick={() => void refresh()}>Refresh cloud list</button>
      <button type="button" className="secondary-button button-sm" disabled={busy || loading || !plan} onClick={() => {
        try { if (plan) setPendingShare(cloudSnapshot(plan)); } catch (error) { setError(cloudError(error)); }
      }}>Share read-only snapshot</button>
    </div>
    {pendingOpen && <div className="inline-confirm" role="group" aria-label="Replace draft with cloud trip">
      <p className="caption-2">Replace the open draft with this cloud trip? Export or save any edits first.</p>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void open(pendingOpen)}>Open cloud trip</button>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingOpen(null)}>Keep draft</button>
    </div>}
    {pendingShare && <div className="inline-confirm" role="group" aria-label="Confirm public snapshot">
      <p className="caption-2">Publish a frozen copy of “{pendingShare.title}”? Anyone with the link can see all included dates, route, budget, estimates, activity notes and sources without signing in. Remove sensitive details before sharing. Future private edits will not change this snapshot. Revoking stops future reads, not copies already downloaded.</p>
      <p className="caption-5">Links use this installation&apos;s address. A localhost link cannot be opened on someone else&apos;s device; public hosting comes in the deployment phase.</p>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void run(() => createCloudShare(api, owner, pendingShare), result => {
        setShares(current => [result.share, ...current]);
        setNewLink({ id: result.share.id, url: `${window.location.origin}/share#token=${result.token}` });
        setPendingShare(null); setMessage("Snapshot published. Copy the link now; its secret token is not stored for later retrieval.");
      })}>Publish snapshot and create link</button>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingShare(null)}>Cancel sharing</button>
    </div>}
    {newLink && <label className="field caption-3">New share link<input className="alpha-input body-6" readOnly value={newLink.url} onFocus={event => event.target.select()} /><span className="caption-5 muted">Copy and keep this link privately. Refreshing or signing out hides it; you can still revoke its snapshot below.</span></label>}
    {pendingDelete && <div className="inline-confirm">
      <p className="caption-2">Delete the cloud copy of “{pendingDelete.title}”? Browser copies and the open draft remain. Published snapshots are separate; revoke them below if needed.</p>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void run(() => deleteCloudTrip(api, owner, pendingDelete.plan_id, pendingDelete.revision), () => {
        setTrips(current => current.filter(row => row.plan_id !== pendingDelete.plan_id));
        setRevisions(current => { const next = { ...current }; delete next[pendingDelete.plan_id]; return next; });
        setPendingDelete(null); setMessage("Cloud copy deleted. Separate browser copies and published snapshots are unchanged.");
      })}>Delete cloud copy</button>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingDelete(null)}>Keep cloud copy</button>
    </div>}
    <ul className="saved-trip-list">{trips.map(trip => <li key={trip.plan_id}>
      <div><button type="button" className="saved-trip-open title-4" disabled={busy} onClick={() => plan ? setPendingOpen(trip) : void open(trip)}>{trip.title}</button><p className="caption-5 muted">Cloud revision {trip.revision} · {new Date(trip.updated_at).toLocaleString()}</p></div>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingDelete(trip)}>Delete cloud trip</button>
    </li>)}</ul>
    {moreTrips && <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void run(() => listCloudTrips(api, owner, trips.length), next => {
      setTrips(current => [...current, ...next.filter(row => !current.some(item => item.plan_id === row.plan_id))]); setMoreTrips(next.length === 100);
    })}>Load older cloud trips</button>}
    {!trips.length && <p className="caption-2 muted">No private trips loaded. Save an open draft or refresh the cloud list.</p>}
    <h4 className="title-4">Published snapshots</h4>
    <ul className="saved-trip-list">{shares.map(share => <li key={share.id}>
      <div><p className="title-4">{share.title}</p><p className="caption-5 muted">Published {new Date(share.created_at).toLocaleString()}</p></div>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingRevoke(share)}>Revoke snapshot</button>
    </li>)}</ul>
    {moreShares && <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void run(() => listCloudShares(api, owner, shares.length), next => {
      setShares(current => [...current, ...next.filter(row => !current.some(item => item.id === row.id))]); setMoreShares(next.length === 100);
    })}>Load older snapshots</button>}
    {pendingRevoke && <div className="inline-confirm">
      <p className="caption-2">Revoke “{pendingRevoke.title}”? Its link will stop loading. This cannot remove copies people already saved.</p>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => void run(() => revokeCloudShare(api, owner, pendingRevoke.id), () => {
        setShares(current => current.filter(row => row.id !== pendingRevoke.id));
        if (newLink?.id === pendingRevoke.id) setNewLink(null);
        setPendingRevoke(null); setMessage("Snapshot revoked. Previously downloaded copies cannot be recalled.");
      })}>Confirm revocation</button>
      <button type="button" className="secondary-button button-sm" disabled={busy} onClick={() => setPendingRevoke(null)}>Keep snapshot</button>
    </div>}
    {(busy || loading) && <p className="caption-2" role="status">{loading ? "Loading cloud lists…" : "Updating cloud data…"}</p>}
    {message && <p className="caption-2 library-status" role="status">{message}</p>}
    {error && <p className="error-message body-6" role="alert">{error}</p>}
  </div>;
}
