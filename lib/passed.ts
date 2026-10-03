import { createHmac, timingSafeEqual } from "node:crypto";

// The server keeps nothing between turns, so the browser sends the whole thread back each
// time. This signature is how the server knows the thread is one it produced. It covers:
//
// - the band;
// - everything she did, in order: her account, each reply, each "mostly disagree" with the
//   cog it answered and the words she wrote with it;
// - what the server offered last: the ask, or a reading led by one particular cog.
//
// So words already in the thread went through the threshold when they were written, a reply
// answers an ask this server made, and a "no" answers a reading this server gave.
export type Step = string[]; // ["wrote", account] | ["added", text] | ["no", cog, note]
export type Offered = "ask" | `lead:${string}`;

export function sign(secret: Buffer, band: string, steps: Step[], offered: Offered): string {
  return createHmac("sha256", secret).update(JSON.stringify([band, steps, offered])).digest("hex");
}

export function verify(secret: Buffer, token: string | undefined, band: string, steps: Step[], offered: Offered): boolean {
  if (!token) return false;
  const expected = Buffer.from(sign(secret, band, steps, offered), "utf8");
  const given = Buffer.from(token, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
