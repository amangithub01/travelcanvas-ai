import { planSchema, type TripRequest } from "./trip";

export async function planTrip(data: TripRequest, signal?: AbortSignal) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"}/plan-trip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result.detail === "string" ? result.detail
      : Array.isArray(result.detail) ? result.detail.map((issue: { msg?: string }) => issue.msg || "Invalid trip details").join(" ")
      : "Your plan could not be loaded. Check the backend connection and try again.";
    throw new Error(message);
  }
  const parsed = planSchema.safeParse(result.plan);
  if (!parsed.success) throw new Error("The planning service returned an unsupported trip format. Your saved trips are unaffected.");
  return parsed.data;
}