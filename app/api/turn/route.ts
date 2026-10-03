import { z } from "zod";
import { BANDS } from "@/lib/bands";
import { collectorFromEnv } from "@/lib/collector";
import { type Data, loadData } from "@/lib/data";
import { assertEnv, StartupError, turnSecret } from "@/lib/env";
import {
  HARD_CHARS,
  HARD_COG_ID_CHARS,
  HARD_SIGNATURE_CHARS,
  HARD_TURNS,
  type Limit,
  MAX_BODY_BYTES,
  RATE_WINDOW_MS,
  RATE_WINDOW_TURNS,
} from "@/lib/limits";
import { anthropicModel, ModelBusy, ModelUnavailable } from "@/lib/model";
import { createLimiter } from "@/lib/rate";
import { runTurn, toResponse, TurnLimit } from "@/lib/turn";

// A turn is at most two model calls.
export const maxDuration = 60;
// The model calls of one turn share this much time, leaving room for the collector write
// and the answer inside maxDuration.
const MODEL_DEADLINE_MS = 50_000;

// Shape only. The system's limits (length, blank text, number of turns) are checked in
// lib/turn.ts, which is also what the evaluation runs and where she gets a sentence about
// them. The bounds here sit well above those limits: they only stop a request that could
// never have come from the page.
const text = z.string().max(HARD_CHARS);
const Body = z.object({
  band: z.enum(BANDS),
  account: text,
  turns: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("more"), text }),
        z.object({ type: z.literal("disagree"), cog: z.string().max(HARD_COG_ID_CHARS), note: text.optional() }),
      ]),
    )
    .max(HARD_TURNS),
  passed: z.string().max(HARD_SIGNATURE_CHARS).optional(),
});

// Reads the body and stops as soon as it is larger than a thread can be.
async function readBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// A backstop behind the platform's own rate limit: a cap on requests per network address,
// per server instance. Every request counts, malformed ones too. See lib/limits.ts.
const overLimit = createLimiter(RATE_WINDOW_MS, RATE_WINDOW_TURNS);

// The address the platform saw the request come from. On Vercel both headers are set by the
// platform itself, so a visitor cannot choose them.
const addressOf = (req: Request) =>
  req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";

const limit = (name: Limit, status: number, held?: boolean) =>
  Response.json(held === undefined ? { limit: name } : { limit: name, held }, { status });

export async function POST(req: Request) {
  try {
    assertEnv();
  } catch (e) {
    console.error(e instanceof StartupError ? e.message : "startup_assertion_failed");
    return limit("unavailable", 500);
  }

  // Admission comes before anything is read from the request.
  if (overLimit(addressOf(req))) return limit("busy", 429);
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return limit("tangled", 413);
  const raw = await readBody(req).catch(() => null);
  if (raw === null) return limit("tangled", 413);
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // not JSON: falls through to the shape check
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return limit("tangled", 400);

  // Data loads per request so an edit to data/ shows up without a restart. If a data file
  // does not load, the message names the file and what is wrong with it. It is about the
  // data files only and holds nothing a teacher wrote.
  let data: Data;
  try {
    data = loadData();
  } catch (e) {
    console.error(`data_load_failed ${e instanceof Error ? e.message : "unknown"}`);
    return limit("unavailable", 500);
  }

  try {
    const result = await runTurn(parsed.data, data, {
      model: anthropicModel(data, { deadline: AbortSignal.timeout(MODEL_DEADLINE_MS) }),
      collector: collectorFromEnv(),
      secret: turnSecret(),
    });
    return Response.json(toResponse(result));
  } catch (e) {
    if (e instanceof TurnLimit) return limit(e.limit, 400);
    // Only fixed labels are logged. Nothing she wrote ever goes to the log.
    if (e instanceof ModelBusy) {
      console.error(e.detail);
      return limit("busy", 503, e.held);
    }
    if (e instanceof ModelUnavailable) {
      console.error(e.detail);
      return limit("unavailable", 502, e.held);
    }
    console.error(`turn_failed ${e instanceof Error ? e.constructor.name : "unknown"}`);
    return limit("unavailable", 500);
  }
}
