import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Band, type Box, childrenOf } from "./boxes";

// Kim's open decisions. These are Luna's defaults until she rules on them (see README).
export const RULES = {
  // After this many "mostly disagree" answers at one level, stop guessing and let the teacher pick.
  maxDisagreementsPerLevel: 2,
  // When nothing fits, the AI may answer "none" and ask the teacher for more detail.
  allowNone: true,
};

const MODEL = "claude-opus-5-5";

export type Turn =
  | { type: "agree"; boxId: string }
  | { type: "disagree"; boxId: string; note?: string }
  | { type: "more"; note: string };

export type InquiryRequest = { band: Band; situation: string; turns: Turn[] };

export type InquiryResult =
  | { kind: "suggest"; boxId: string; explanation: string; evidence: string; parentId: string }
  | { kind: "none"; explanation: string; evidence: string; parentId: string }
  | { kind: "choose"; parentId: string; options: string[] }
  | { kind: "done"; path: string[] };

const SYSTEM = `You are the first step of a coaching tool for teachers. A teacher picked a grade band and described something happening in their classroom. Your only job: decide which ONE of the boxes provided their situation sounds MOST like as a starting point, then tell them in plain language what that means.

Rules:
- Choose only from the boxes provided. What each box means comes only from its definition, indicators, grade-band notes, examples, and near-misses. Do not bring in outside frameworks, labels, or research.
- Read what the teacher said through the grade band they picked.
- Use the near-misses to separate boxes that sound alike.
- If the teacher has already disagreed with a box, it is not offered again. Treat what they said when disagreeing as new information about their situation.
- If the situation is not about any of the boxes (for example a parent conflict, paperwork, or curriculum planning), choose "none".
- Do not give advice or solutions. This step only names a starting point.

"explanation" is shown to the teacher. Two or three short sentences, warm and plain, no jargon. Use this shape: "This sounds mostly like <box id> to me. That means we're starting by looking at <what the box means, tied to what they described>." Do not ask a question; the app asks whether they agree. For "none", say plainly that it doesn't sound like something these boxes cover and ask them to say a bit more about what's happening in the room.

"evidence" is for the person who wrote the boxes, not the teacher: which of the teacher's words matched which indicator, example, or near-miss, and why the closest other box lost.`;

function renderBox(box: Box, band: Band): string {
  return [
    `<box id="${box.id}" name="${box.name}">`,
    `Definition: ${box.definition}`,
    `Indicators:\n${box.indicators}`,
    box.bands[band] ? `In ${band}: ${box.bands[band]}` : "",
    `Things teachers say that belong here:\n${box.examples}`,
    box.nearMisses ? `Near-misses:\n${box.nearMisses}` : "",
    `</box>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTurns(turns: Turn[], byId: Map<string, Box>): string {
  return turns
    .map((t) => {
      if (t.type === "more") return `- The teacher added: "${t.note}"`;
      const name = `${t.boxId} (${byId.get(t.boxId)?.name ?? "?"})`;
      if (t.type === "agree") return `- The teacher agreed the starting point is ${name}.`;
      return `- The teacher disagreed with ${name}${t.note ? ` and said: "${t.note}"` : "."}`;
    })
    .join("\n");
}

const client = new Anthropic();

export class InvalidHistory extends Error {}

export async function inquire(req: InquiryRequest, boxes: Box[]): Promise<InquiryResult> {
  const byId = new Map(boxes.map((b) => [b.id, b]));

  // Replay the conversation from the top: every agree/disagree must name a child of the box
  // agreed to just before it, so the path is always a real walk down the tree.
  let parentId = "root";
  const path: string[] = [];
  let rejected: string[] = [];
  for (const t of req.turns) {
    if (t.type === "more") continue;
    if (!childrenOf(boxes, parentId).some((c) => c.id === t.boxId)) {
      throw new InvalidHistory(`${t.boxId} is not inside ${parentId}`);
    }
    if (t.type === "agree") {
      path.push(t.boxId);
      parentId = t.boxId;
      rejected = [];
    } else if (!rejected.includes(t.boxId)) {
      rejected.push(t.boxId);
    }
  }

  const children = childrenOf(boxes, parentId);
  if (children.length === 0) return { kind: "done", path };
  const candidates = children.filter((c) => !rejected.includes(c.id));
  if (rejected.length >= RULES.maxDisagreementsPerLevel || candidates.length === 0) {
    return { kind: "choose", parentId, options: children.map((c) => c.id) };
  }

  const ids = candidates.map((c) => c.id);
  const choices = (RULES.allowNone ? [...ids, "none"] : ids) as [string, ...string[]];
  const Answer = z.object({
    evidence: z.string(),
    box_id: z.enum(choices),
    explanation: z.string(),
  });

  const parent = byId.get(parentId);
  const prompt = [
    `Grade band: ${req.band}`,
    parent ? `Already agreed: the starting point is ${parent.id} (${parent.name}). Now choose one level deeper, inside it.` : "",
    `Boxes you may choose from:\n${candidates.map((c) => renderBox(c, req.band)).join("\n\n")}`,
    `What the teacher typed:\n"""${req.situation}"""`,
    req.turns.length ? `What has happened since:\n${renderTurns(req.turns, byId)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(Answer) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") throw new Error("The AI declined to answer this one.");
  const out = response.parsed_output;
  if (!out) throw new Error(`No usable answer (stop_reason: ${response.stop_reason})`);

  if (out.box_id === "none") return { kind: "none", explanation: out.explanation, evidence: out.evidence, parentId };
  return { kind: "suggest", boxId: out.box_id, explanation: out.explanation, evidence: out.evidence, parentId };
}
