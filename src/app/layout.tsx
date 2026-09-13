import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
export const metadata: Metadata = {
  title: "PocketPot — Bring everyone to the table",
  description:
    "The private, shared chip ledger for your next poker night. Real cards, no physical chips.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PocketPot" },
  icons: { icon: "/icon.svg", apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c1110" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
