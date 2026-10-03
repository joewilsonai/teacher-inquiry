import { randomBytes } from "node:crypto";
import { collectorKind } from "./collector";

// What a deployment needs before it may take a teacher's words. Checked once, on the first
// request, so a deploy that cannot keep or sign anything says so right away instead of
// failing quietly on every turn.
export function missingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (env.VERCEL && !env.TURN_SECRET) missing.push("TURN_SECRET");
  // The blob store takes either a read-write token, or the project's own identity plus the
  // store id (Vercel supplies the identity itself on each request).
  if (collectorKind(env) === "blob" && !env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID) {
    missing.push("BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID");
  }
  return missing;
}

let checked: string[] | undefined;
export function assertEnv(): void {
  checked ??= missingEnv();
  if (checked.length > 0) throw new StartupError(checked);
}

export class StartupError extends Error {
  constructor(public missing: string[]) {
    super(`startup_assertion_failed missing: ${missing.join(", ")}`);
  }
}

// The key that signs "these words already passed the door". On Vercel it must be set
// (assertEnv). Anywhere else, one random key per process is enough; it is kept on
// globalThis so a dev-server reload does not orphan a thread in progress.
const holder = globalThis as { __turnSecret?: Buffer };
export function turnSecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  if (env.TURN_SECRET) return Buffer.from(env.TURN_SECRET, "utf8");
  holder.__turnSecret ??= randomBytes(32);
  return holder.__turnSecret;
}
