import { planSchema, type TripRequest } from "./trip.ts";
import { cloudConfigured, getCloudClient } from "./cloud.ts";

export async function planTrip(data: TripRequest, signal?: AbortSignal) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.NEXT_PUBLIC_REQUIRE_LOGIN === "true" && !cloudConfigured) {
    throw new Error("This staging planner requires configured cloud sign-in. Browser saves and exports still work.");
  }
  if (cloudConfigured) {
    const { data: session, error } = await getCloudClient().auth.getSession();
    if (error) throw new Error("Your account session could not be read. Sign in again before planning.");
    if (session.session) headers.Authorization = `Bearer ${session.session.access_token}`;
    else if (process.env.NEXT_PUBLIC_REQUIRE_LOGIN === "true") throw new Error("Sign in to your cloud account before generating a staging plan.");
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/plan-trip`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result?.detail === "string" ? result.detail
      : Array.isArray(result?.detail) ? result.detail.map((issue: { msg?: string }) => issue.msg || "Invalid trip details").join(" ")
        : response.status === 429 ? "The staging gateway is limiting requests. Wait a minute before trying again."
          : response.status === 401 ? "Sign in again before generating a staging plan."
            : "Your plan could not be loaded. Check the backend connection and try again.";
    throw new Error(message);
  }
  const parsed = planSchema.safeParse(result?.plan);
  if (!parsed.success) throw new Error("The planning service returned an unsupported trip format. Your saved trips are unaffected.");
  return parsed.data;
}