// The three grade bands. She picks one on the first screen; the system never infers it.
// Safe to import from the browser (no file access here).
export const BANDS = ["K-2", "3-5", "6-8"] as const;
export type Band = (typeof BANDS)[number];

// What she sees. The wire ids above use plain hyphens.
export const BAND_LABELS: Record<Band, string> = { "K-2": "K–2", "3-5": "3–5", "6-8": "6–8" };
