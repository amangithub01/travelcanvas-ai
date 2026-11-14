import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_IMPORT_BYTES, planSchema, type TripPlan } from "./trip.ts";

let client: SupabaseClient | null = null;
const cloudUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cloudKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const cloudConfigured = (() => {
  try {
    const url = new URL(cloudUrl || "");
    return !!cloudKey?.startsWith("sb_publishable_") && !url.username && !url.password
      && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { return false; }
})();

export function getCloudClient() {
  if (!cloudConfigured) throw new Error("Cloud accounts are not configured. Browser saves and JSON exports still work.");
  if (!client) client = createClient(cloudUrl!, cloudKey!);
  return client;
}

const summarySchema = z.object({
  plan_id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  revision: z.number().int().positive(),
  updated_at: z.iso.datetime({ offset: true }),
});
const shareSchema = z.object({
  id: z.uuid(), plan_id: z.string(), title: z.string(), created_at: z.iso.datetime({ offset: true }),
});
export type CloudTrip = z.infer<typeof summarySchema>;
export type CloudShare = z.infer<typeof shareSchema>;

function failure(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new Error("A cloud copy already exists. Open it before saving so newer edits are not overwritten.");
  throw new Error("Cloud action failed. Check your connection, sign-in, and Supabase setup. Your open draft and browser copies are unchanged.");
}

export function cloudSnapshot(plan: TripPlan) {
  const parsed = planSchema.parse(plan);
  if (new TextEncoder().encode(JSON.stringify(parsed)).length > MAX_IMPORT_BYTES) throw new Error("Cloud trip snapshots must be smaller than 2 MB. Export a copy instead.");
  return parsed;
}

export async function listCloudTrips(api: SupabaseClient, owner: string, offset = 0) {
  const { data, error } = await api.from("travel_trips").select("plan_id,title,revision,updated_at").eq("owner_id", owner).order("updated_at", { ascending: false }).order("plan_id").range(offset, offset + 99);
  failure(error);
  return z.array(summarySchema).parse(data);
}

export async function openCloudTrip(api: SupabaseClient, owner: string, id: string) {
  const { data, error } = await api.from("travel_trips").select("plan,revision").eq("owner_id", owner).eq("plan_id", id).single();
  failure(error);
  const row = z.object({ plan: planSchema, revision: z.number().int().positive() }).parse(data);
  if (row.plan.id !== id) throw new Error("Cloud trip identity does not match. Your open draft is unchanged.");
  return row;
}

export async function saveCloudTrip(api: SupabaseClient, owner: string, plan: TripPlan, revision: number | null) {
  const snapshot = cloudSnapshot(plan);
  const table = api.from("travel_trips");
  const query = revision === null
    ? table.insert({ owner_id: owner, plan_id: snapshot.id, plan: snapshot })
    : table.update({ plan: snapshot }).eq("owner_id", owner).eq("plan_id", snapshot.id).eq("revision", revision);
  const { data, error } = await query.select("plan_id,title,revision,updated_at").maybeSingle();
  failure(error);
  if (!data) throw new Error("Cloud copy changed or was deleted on another device. Export your edits, then reopen the cloud copy before saving.");
  return summarySchema.parse(data);
}

export async function deleteCloudTrip(api: SupabaseClient, owner: string, id: string, revision: number) {
  const { data, error } = await api.from("travel_trips").delete().eq("owner_id", owner).eq("plan_id", id).eq("revision", revision).select("plan_id");
  failure(error);
  if (!data?.length) throw new Error("Cloud copy changed. Refresh the list before deleting it.");
}

export async function listCloudShares(api: SupabaseClient, owner: string, offset = 0) {
  const { data, error } = await api.from("travel_shares").select("id,plan_id,title,created_at").eq("owner_id", owner).order("created_at", { ascending: false }).order("id").range(offset, offset + 99);
  failure(error);
  return z.array(shareSchema).parse(data);
}

export async function createCloudShare(api: SupabaseClient, owner: string, plan: TripPlan) {
  const snapshot = cloudSnapshot(plan);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const token_hash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await api.from("travel_shares").insert({
    owner_id: owner, plan_id: snapshot.id, plan: snapshot, token_hash,
  }).select("id,plan_id,title,created_at").single();
  failure(error);
  return { share: shareSchema.parse(data), token };
}

export async function revokeCloudShare(api: SupabaseClient, owner: string, id: string) {
  const { error } = await api.from("travel_shares").delete().eq("owner_id", owner).eq("id", id);
  failure(error);
}

export async function readCloudShare(api: SupabaseClient, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("This share link is invalid.");
  const { data, error } = await api.rpc("read_travel_share", { p_token: token });
  failure(error);
  if (!data) throw new Error("This shared snapshot is unavailable or its owner revoked the link.");
  return cloudSnapshot(data);
}
