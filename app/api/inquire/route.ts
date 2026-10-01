import { z } from "zod";
import { BANDS, loadBoxes } from "@/lib/boxes";
import { inquire } from "@/lib/inquire";

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
    .max(30),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That request didn't look right." }, { status: 400 });
  try {
    // Boxes load per request so edits to data/boxes show up without a restart.
    return Response.json(await inquire(parsed.data, loadBoxes()));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Something went wrong reaching the AI. Try again." }, { status: 502 });
  }
}
