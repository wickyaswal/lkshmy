import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "react-tooltip/dist/react-tooltip.css";

export const metadata: Metadata = {
  title: "Fiat Buffer Trading Assistant",
  description: "Deterministic manual-trading assistant with Kraken read-only autopilot monitoring."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
