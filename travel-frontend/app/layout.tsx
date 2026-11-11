import type { Metadata } from "next";
import { DM_Serif_Display, Geist } from "next/font/google";
import "./globals.css";
import "./showcase.css";
import "./workspace.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const editorialDisplay = DM_Serif_Display({
  variable: "--font-editorial",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "AI Travel Planner | Your next adventure, beautifully planned",
  description: "Plan your next trip with AI itineraries, live weather, flight options, curated stays, and local discoveries.",
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "AI Travel Planner",
    description: "Your flights, stays, and daily discoveries in one travel plan.",
    images: [{ url: "/travel-cover.jpg", width: 1200, height: 1807, alt: "Travel inspiration" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${editorialDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
