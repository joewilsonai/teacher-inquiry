// The system's own limits, in one place. Every textarea and the request check use these;
// the sentence she sees for each one lives in data/copy.md under "limits.<name>".
// Safe to import from the browser.

// Characters the system holds in one piece of text.
export const MAX_CHARS = 2000;

// Turns in one thread.
export const MAX_TURNS = 20;

// Longest clause the model may supply for the middle of the paraphrase before the
// cog's authored fallback is used instead.
export const MAX_MEANING_CHARS = 300;

export const LIMITS = ["unavailable", "busy", "long", "empty", "turns", "tangled", "offline"] as const;
export type Limit = (typeof LIMITS)[number];

// Limits that say nothing about her thread, only that the system did not answer this time.
// The page offers to send the same turn again, so she never has to retype it.
export const RETRY_LIMITS: readonly Limit[] = ["unavailable", "busy", "offline"];

// The in-app cap on turns from one network address. It is a backstop behind the platform's
// own rate limit, not the limit itself. A whole school can sit behind one address, so it is
// sized for a staff meeting: forty teachers, five turns each, inside ten minutes.
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_WINDOW_TURNS = 200;

// Hard edges of a request. These sit well above the limits a teacher can meet, which each
// have a sentence of their own. They only stop a request that could not have come from the
// page: one that is too large, or shaped to cost something before the checks above run.
export const HARD_CHARS = MAX_CHARS * 4;
export const HARD_TURNS = MAX_TURNS * 2;
export const HARD_COG_ID_CHARS = 16;
export const HARD_SIGNATURE_CHARS = 1024;
export const MAX_BODY_BYTES = 256 * 1024;
