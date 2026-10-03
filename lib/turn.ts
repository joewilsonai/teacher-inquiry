import type { Band } from "./bands";
import { type Collector, type CollectorRecord, NoCollector } from "./collector";
import type { CogId, Data } from "./data";
import { type Limit, MAX_CHARS, MAX_TURNS } from "./limits";
import { ModelBusy, type ModelClient, ModelUnavailable, type ReadOutput, type ThreadEvent } from "./model";
import { compose, type Paraphrase } from "./paraphrase";
import { type Offered, sign, type Step, verify } from "./passed";

// One turn of the loop: band -> her account -> the threshold -> a reading -> the paraphrase.
// Her answer to the paraphrase comes back in as the next turn. The server keeps nothing in
// between; the browser sends the whole thread each time.

export type Turn =
  | { type: "more"; text: string } // her reply when asked what was happening
  | { type: "disagree"; cog: CogId; note?: string }; // "mostly agree" never reaches the server

export type TurnRequest = { band: Band; account: string; turns: Turn[]; passed?: string };

export type TurnResponse =
  // Beyond what this system works in: one authored sentence, and the turn stops.
  | { kind: "beyond"; area: string; sentence: string; held: boolean }
  // Nothing to land on yet: ask what was happening.
  | { kind: "ask"; sentence: string; held: boolean; passed: string }
  // A reading: one cog leads, any others are named in the text.
  | { kind: "reading"; lead: CogId; others: CogId[]; text: string; cite: string; question: string; held: boolean; passed: string };

// What the evaluation looks at and the browser never receives.
export type TurnResult = TurnResponse & {
  // Why she was asked what was happening: she named a topic; a reading would need a motive
  // assumed; a situation landed on none of the four; or she said no and nothing else fits.
  reason?: "topic_only" | "intent_needed" | "nocog" | "after_no";
  read?: ReadOutput;
  paraphrase?: Paraphrase;
};

export function toResponse(r: TurnResult): TurnResponse {
  if (r.kind === "beyond") return { kind: r.kind, area: r.area, sentence: r.sentence, held: r.held };
  if (r.kind === "ask") return { kind: r.kind, sentence: r.sentence, held: r.held, passed: r.passed };
  const { kind, lead, others, text, cite, question, held, passed } = r;
  return { kind, lead, others, text, cite, question, held, passed };
}

// A limit of the system, named so the page can show the authored sentence for it.
export class TurnLimit extends Error {
  constructor(public limit: Limit) {
    super(limit);
  }
}

export type Deps = { model: ModelClient; collector: Collector; secret: Buffer };

const blank = (s: string | undefined) => !s || s.trim() === "";

// What she did, in order, in the form the thread's signature covers.
export function steps(account: string, turns: Turn[]): Step[] {
  return [
    ["wrote", account],
    ...turns.map((t): Step => (t.type === "more" ? ["added", t.text] : ["no", t.cog, blank(t.note) ? "" : t.note!])),
  ];
}

// A write never stops a turn. It reports whether her words were actually kept, because the
// page may only say they are held when they are.
const WRITE_TIMEOUT_MS = 4000;
async function write(collector: Collector, record: CollectorRecord): Promise<boolean> {
  if (collector instanceof NoCollector) {
    // Switched off on purpose (COLLECTOR=none). Nothing is kept, she is not told it was, and
    // the log says so each time a record would have been written. A fixed label, none of her words.
    console.warn("collector_off record_not_kept");
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    await Promise.race([
      collector.append(record, controller.signal),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }),
      ),
    ]);
    return true;
  } catch (e) {
    const kind = e instanceof Error ? (e.message === "timeout" ? "timeout" : e.constructor.name) : "unknown";
    console.error(`collector_write_failed ${kind}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTurn(
  req: TurnRequest,
  data: Data,
  deps: Deps,
  options: { debug?: boolean } = {},
): Promise<TurnResult> {
  const { band, account, turns } = req;
  const cogById = new Map(data.cogs.map((c) => [c.id, c]));

  // The system's own limits.
  if (turns.length > MAX_TURNS) throw new TurnLimit("turns");
  if ([account, ...turns.map((t) => (t.type === "more" ? t.text : (t.note ?? "")))].some((s) => s.length > MAX_CHARS)) {
    throw new TurnLimit("long");
  }
  if (blank(account) || turns.some((t) => t.type === "more" && blank(t.text))) throw new TurnLimit("empty");
  if (turns.some((t) => t.type === "disagree" && !cogById.has(t.cog))) throw new TurnLimit("tangled");

  // Everything she did, in order, and everything she wrote, verbatim.
  const thread: ThreadEvent[] = [{ kind: "wrote", text: account }];
  for (const t of turns) {
    if (t.type === "more") thread.push({ kind: "added", text: t.text });
    else thread.push({ kind: "no", cog: t.cog, note: blank(t.note) ? undefined : t.note });
  }
  const words = thread.flatMap((e) => (e.kind === "no" ? (e.note ? [e.note] : []) : [e.text]));
  const statement = words.join("\n\n");

  const last = turns.at(-1);
  const bareNo = last?.type === "disagree" && blank(last.note) ? last.cog : null;

  // 1. The thread has to be one this server produced. Its signature says every earlier word
  //    went through the threshold, and that what she is answering now was really offered:
  //    a reply answers an ask, and a "no" answers a reading led by that same cog.
  if (last) {
    const answers: Offered = last.type === "more" ? "ask" : `lead:${last.cog}`;
    if (!verify(deps.secret, req.passed, band, steps(account, turns.slice(0, -1)), answers)) throw new TurnLimit("tangled");
  }
  const passedFor = (offered: Offered) => sign(deps.secret, band, steps(account, turns), offered);

  // "held" is true only if every write this turn succeeded.
  let held: boolean | undefined;
  const keep = async (fellThrough: string) => {
    const ok = await write(deps.collector, { statement, fellThrough });
    held = held === undefined ? ok : held && ok;
  };

  try {
    // 2. Her "no" is kept first, so it survives whatever happens next.
    if (last?.type === "disagree") await keep(`${last.cog}, she said no`);

    // 3. The threshold, whenever new words come in: her opening account, her reply when
    //    asked what was happening, and anything she writes with "mostly disagree". No word
    //    of hers is read before it has been through this door.
    if (!bareNo) {
      const { scope } = await deps.model.threshold({
        earlier: words.slice(0, -1),
        newText: words.at(-1)!,
        afterNo: last?.type === "disagree",
      });
      if (scope !== "inside") {
        const place = data.beyond.find((b) => b.id === scope);
        if (!place) throw new ModelUnavailable("model_unparsed scope");
        await keep("threshold");
        return { kind: "beyond", area: place.id, sentence: place.sentence, held: held ?? false };
      }
    }
    const ask = (reason: TurnResult["reason"], read: ReadOutput): TurnResult => ({
      kind: "ask",
      reason,
      read,
      sentence: data.copy["ask.sentence"],
      held: held ?? false,
      passed: passedFor("ask"),
    });

    // 4. The reading. All of her words are read again each turn.
    const read = await deps.model.read({ thread, bareNo, debug: options.debug });

    // A topic, or a reading that would need a motive assumed: ask. Her sentence governs
    // over any cog the model may have listed anyway.
    if (read.situation !== "present") return ask(read.situation, read);

    const found = [...new Set(read.cogs)].flatMap((id) => cogById.get(id) ?? []);
    // She said no to this cog and wrote nothing. It is not offered again on this turn;
    // anything else that fits still is.
    const cogs = bareNo ? found.filter((c) => c.id !== bareNo) : found;

    if (cogs.length === 0) {
      // After a "no", the account did find a cog and her no is already kept with these same
      // words. That is the one record for this turn.
      if (last?.type === "disagree") return ask("after_no", read);
      // A situation that came through the door and lands on none of the four: ask, and keep it.
      await keep("no cog");
      return ask("nocog", read);
    }

    // The model's clause was written for the cog it put first. If that one was just removed,
    // the cog that now leads uses its own authored clause.
    const paraphrase = compose(cogs, cogs[0] === found[0] ? read.meaning : "", data.copy);
    if (paraphrase.fallback) console.warn(`meaning_fallback ${cogs[0].id}`);
    return {
      kind: "reading",
      lead: cogs[0].id,
      others: cogs.slice(1).map((c) => c.id),
      text: paraphrase.text,
      cite: paraphrase.cite,
      question: paraphrase.question,
      held: held ?? false,
      passed: passedFor(`lead:${cogs[0].id}`),
      read,
      paraphrase,
    };
  } catch (e) {
    // If her "no" was already kept, the page can still say so on the limit card.
    if (e instanceof ModelUnavailable || e instanceof ModelBusy) e.held = held ?? false;
    throw e;
  }
}
