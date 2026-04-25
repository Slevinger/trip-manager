import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Hebrew } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import { I18nProvider } from "@/components/providers/I18nProvider";

const noto = Noto_Sans({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  variable: "--font-noto",
  display: "swap",
});

const notoHebrew = Noto_Sans_Hebrew({
  subsets: ["hebrew"],
  variable: "--font-noto-he",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trip Planner",
  description: "Collaborative trip planning with realtime sync",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" suppressHydrationWarning>
      <body
        className={`${noto.variable} ${notoHebrew.variable} min-h-full bg-zinc-50 font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-50`}
      >
        <I18nProvider>
          <div className="flex min-h-full flex-col">{children}</div>
        </I18nProvider>
      </body>
    </html>
  );
}
