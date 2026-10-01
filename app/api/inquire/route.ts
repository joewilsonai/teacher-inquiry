import { z } from "zod";
import { BANDS, loadBoxes } from "@/lib/boxes";
import { InvalidHistory, inquire } from "@/lib/inquire";

const MAX_TURNS = 40;

const Body = z.object({
  band: z.enum(BANDS),
  situation: z.string().trim().min(3).max(2000),
  turns: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("agree"), boxId: z.string().max(20) }),
        z.object({ type: z.literal("disagree"), boxId: z.string().max(20), note: z.string().trim().max(1000).optional() }),
        z.object({ type: z.literal("more"), note: z.string().trim().min(1).max(1000) }),
      ]),
    )
    .max(MAX_TURNS),
});

// Per-instance cap on AI calls per visitor. The real gate is SITE_PASSWORD (proxy.ts);
// this stops one person from burning the budget in a loop.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 40;
const calls = new Map<string, number[]>();

function overLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (calls.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  calls.set(ip, recent);
  return recent.length > MAX_CALLS;
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "This conversation got too long or tangled. Start over to try again." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (overLimit(ip)) {
    return Response.json({ error: "That's a lot of questions in a short time. Give it a few minutes." }, { status: 429 });
  }
  try {
    // Boxes load per request so edits to data/boxes show up without a restart.
    return Response.json(await inquire(parsed.data, loadBoxes()));
  } catch (e) {
    if (e instanceof InvalidHistory) {
      return Response.json({ error: "This conversation got out of order. Start over to try again." }, { status: 400 });
    }
    console.error(e);
    return Response.json({ error: "Something went wrong reaching the AI. Try again." }, { status: 502 });
  }
}
