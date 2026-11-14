import type { Metadata } from "next";
import { SharedTrip } from "./shared-trip";

export const metadata: Metadata = {
  title: "Shared travel snapshot | AI Travel Planner",
  description: "A read-only travel snapshot shared by its author.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: { title: "Shared travel snapshot", description: "Open the link to view a shared travel draft." },
};

export default function SharePage() {
  return <SharedTrip />;
}
