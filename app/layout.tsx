import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Fraunces } from "next/font/google";
import { loadCopy } from "@/lib/data";
import "./globals.css";

const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export function generateMetadata(): Metadata {
  // If the copy file does not load, the page below says so (app/error.tsx). The frame
  // around it should still stand, so the tab simply goes without a title.
  try {
    const { copy } = loadCopy();
    return { title: copy["site.title"], description: copy["site.description"] };
  } catch {
    return {};
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
