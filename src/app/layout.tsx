import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource/instrument-serif";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axelyn Signal",
  description: "Multi-model content intelligence for Axelyn Technologies",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
