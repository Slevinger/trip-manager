import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trip planner (canonical)",
  description: "Trips with ISO dates, intervals, travelers, tasks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
