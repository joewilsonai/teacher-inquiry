// Sends every account in data/tests.md through the same turn a teacher gets, with the real
// model, and compares what comes back with what the file says should.
// Run: npm run eval            (spends real API money: about a hundred model calls)
//      npm run eval -- --only "carpet"     only accounts containing that text
//      npm run eval -- --no-why            skip the second look at misses
//      npm run eval -- --show              print every reading in full, not only the misses
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { BANDS, type Band } from "../lib/bands";
import { loadData } from "../lib/data";
import { anthropicModel, ModelBusy, ModelUnavailable, type Usage } from "../lib/model";
import { fill } from "../lib/slots";
import { runTurn, type Turn, TurnLimit, type TurnResult } from "../lib/turn";
import {
  COG_NUMBER,
  count,
  type Event,
  hasWord,
  logged,
  MemoryCollector,
  NOT_HER_ERROR,
  NOT_IN_A_READING,
  NOT_SAID_OF_5K,
  TEST_SECRET,
} from "./harness";

const data = loadData();
const copy = data.copy;
const cogName = (id: string) => data.cogs.find((c) => c.id === id)?.name ?? id;
const cogIds = data.cogs.map((c) => c.id);
const beyondIds = data.beyond.map((b) => b.id);

// ---- reading data/tests.md -----------------------------------------------------------------

type Step = {
  does: "open" | "more" | "disagree" | "agree";
  expect: string;
  excludes: string[];
  text: string;
  probe: boolean;
  line: number;
};
type Case = { band: Band; steps: Step[] };

function parseStep(rest: string, does: Step["does"], line: number): Step {
  const probe = /\s#\s*line probe\s*$/.test(rest);
  let body = rest.replace(/\s+#[^#]*$/, "").trim();
  const tag = body.match(/^\[([^\]]+)\]\s*/);
  if (!tag) throw new Error(`data/tests.md line ${line}: missing [what should come back]`);
  const expect = tag[1];
  body = body.slice(tag[0].length);
  const excludes: string[] = [];
  for (let m = body.match(/^\[!([^\]]+)\]\s*/); m; m = body.match(/^\[!([^\]]+)\]\s*/)) {
    excludes.push(m[1]);
    body = body.slice(m[0].length);
  }
  const [kind, arg] = expect.split(":");
  const known =
    (["ask", "nocog", "several", "settled"].includes(expect)) ||
    (["one", "several", "not"].includes(kind) && cogIds.includes(arg)) ||
    (kind === "beyond" && beyondIds.includes(arg)) ||
    cogIds.includes(expect);
  if (!known) throw new Error(`data/tests.md line ${line}: "[${expect}]" is not something the system can return`);
  return { does, expect, excludes, text: body.trim(), probe, line };
}

function parseTests(): Case[] {
  const cases: Case[] = [];
  fs.readFileSync(path.join(process.cwd(), "data", "tests.md"), "utf8")
    .split("\n")
    .forEach((raw, i) => {
      const top = raw.match(/^- \[([^\]]+)\] (.+)$/);
      const next = raw.match(/^ {2}- \[(more|disagree|agree)\] (.+)$/);
      if (top) {
        if (!BANDS.includes(top[1] as Band)) throw new Error(`data/tests.md line ${i + 1}: "${top[1]}" is not a band`);
        cases.push({ band: top[1] as Band, steps: [parseStep(top[2], "open", i + 1)] });
      } else if (next) {
        if (!cases.length) throw new Error(`data/tests.md line ${i + 1}: a follow-up with no account above it`);
        cases.at(-1)!.steps.push(parseStep(next[2], next[1] as Step["does"], i + 1));
      }
    });
  return cases;
}

// ---- judging one step ---------------------------------------------------------------------

// What came back, in the words of the test file.
function got(r: TurnResult): string {
  if (r.kind === "beyond") return `beyond:${r.area}`;
  if (r.kind === "ask") return r.reason === "nocog" ? "nocog" : `ask (${r.reason})`;
  return r.others.length ? `several:${r.lead} +${r.others.join("+")}` : `one:${r.lead}`;
}

function matches(expect: string, r: TurnResult): boolean {
  const [kind, arg] = expect.split(":");
  if (kind === "beyond") return r.kind === "beyond" && r.area === arg;
  if (expect === "ask") return r.kind === "ask" && r.reason !== "nocog";
  if (expect === "nocog") return r.kind === "ask" && r.reason === "nocog";
  if (kind === "not") return !(r.kind === "reading" && r.lead === arg);
  if (r.kind !== "reading") return false;
  if (kind === "one") return r.lead === arg && r.others.length === 0;
  if (kind === "several") return r.others.length >= 1 && (!arg || r.lead === arg);
  return r.lead === expect;
}

const category = (step: Step) => {
  if (step.does !== "open") return `after ${step.does}`;
  const kind = step.expect.split(":")[0];
  return ["one", "several", "ask", "nocog", "beyond", "not"].includes(kind) ? kind : "lead";
};

// Things that must hold whatever the score. Each returns what is wrong, in plain words.
function structure(step: Step, r: TurnResult, ctx: { events: Event[]; newRecords: { statement: string; fellThrough: string }[]; statement: string; newText?: string; rejected?: string; note?: string }): string[] {
  const wrong: string[] = [];
  const said = (r.kind === "reading" ? `${r.text} ${r.question}` : r.sentence) + (r.held ? ` ${copy["held.sentence"]}` : "");
  const records = ctx.newRecords.map((x) => x.fellThrough);
  const expectRecords: string[] = [];
  if (step.does === "disagree") expectRecords.push(`${ctx.rejected}, she said no`);

  for (const word of step.excludes) if (hasWord(said, word)) wrong.push(`shows the word "${word}"`);
  for (const word of NOT_HER_ERROR) if (hasWord(said, word)) wrong.push(`says "${word}"`);

  if (r.kind === "beyond") {
    expectRecords.push("threshold");
    if (count(ctx.events, "read") !== 0) wrong.push("a reading was built for an account beyond the threshold");
    if (r.sentence !== data.beyond.find((b) => b.id === r.area)?.sentence) wrong.push("the sentence is not the authored one");
    if ("passed" in r || "lead" in r || "text" in r) wrong.push("a beyond response carries reading fields");
  }

  if (r.kind === "ask") {
    if (r.reason === "nocog") expectRecords.push("no cog");
    if (r.sentence !== copy["ask.sentence"]) wrong.push("the ask is not the authored sentence");
    if (data.cogs.some((c) => said.includes(c.name))) wrong.push("an ask names a cog");
  }

  if (r.kind === "reading") {
    const lead = data.cogs.find((c) => c.id === r.lead)!;
    const s = r.paraphrase!.sentences;
    const article = /^[aeiou]/i.test(lead.name) ? "an" : "a";
    if (s.lead !== fill(copy["paraphrase.lead"], { article, name: lead.name })) wrong.push("sentence 1 is not the frame with the recognition name");
    if (!r.text.startsWith("This sounds mostly like a")) wrong.push("does not start with the frame");
    if (!r.text.includes(" issue. In this model that means ")) wrong.push("the frame is broken between sentences 1 and 2");
    if (!r.text.includes(r.cite)) wrong.push("the citation is missing from the text");
    if (lead.citeSentence ? r.cite !== lead.citeSentence : r.cite !== `That reading comes from ${lead.cite}.`) wrong.push("the citation is not the authored one");
    if (r.question !== copy["paraphrase.question"]) wrong.push("the closing question is not the authored one");
    if (r.text.includes(copy["ask.sentence"])) wrong.push("a reading also asks for more");
    for (const part of [s.lead, s.meaning, s.others]) {
      if (COG_NUMBER.test(part)) wrong.push(`a cog number outside the citation: "${part}"`);
      for (const c of data.cogs) if (c.cite && part.includes(c.cite.replace(/^\S+\s/, ""))) wrong.push(`Missouri's name outside the citation: "${part}"`);
    }
    for (const word of NOT_IN_A_READING) if (hasWord(said, word)) wrong.push(`the reading says "${word}"`);
    if (lead.citeSentence) for (const word of NOT_SAID_OF_5K) if (hasWord(said, word)) wrong.push(`says "${word}" of ${lead.id}`);
    for (const id of r.others) if (!r.text.includes(cogName(id))) wrong.push(`${id} fired and is not named`);
    // Each other cog is named in the authored sentence, one sentence per cog.
    if (s.others !== r.others.map((id) => fill(copy["paraphrase.others"], { name: cogName(id) })).join(" ")) wrong.push("the others are not each named in the authored sentence");
    if (/[{}]/.test(r.text)) wrong.push("a frame was left unfilled");
    if (ctx.rejected && !ctx.note && [r.lead, ...r.others].includes(ctx.rejected)) wrong.push("the cog she said no to, with no words, is named again on the same turn");
    if (r.others.length && [r.lead, ...r.others].filter((id) => r.text.includes(cogName(id))).length < 2) wrong.push("several fired but fewer than two are named");
    if (step.does === "disagree" && !ctx.note && r.lead === ctx.rejected) wrong.push("the same reading came back after a no with no words");
  }

  // The collector: exactly the records this turn should have made, and "held" said only when they were.
  if (records.join("|") !== expectRecords.join("|")) wrong.push(`collector got [${records.join(" | ")}], expected [${expectRecords.join(" | ")}]`);
  if (r.held !== expectRecords.length > 0) wrong.push(`held is ${r.held} with ${expectRecords.length} records`);
  for (const rec of ctx.newRecords) if (rec.statement !== ctx.statement) wrong.push("the record is not her words verbatim");
  // The door. Whatever she wrote on this turn went through the threshold once, before any
  // reading: her opening account, her reply to the ask, and a note written with a "no".
  const order = ctx.events.map((e) => e.what);
  const doors = ctx.events.flatMap((e) => (e.what === "threshold" ? [e.input] : []));
  if (ctx.newText === undefined) {
    if (doors.length !== 0) wrong.push("a no with no words went through the threshold");
  } else {
    if (doors.length !== 1) wrong.push(`her new words went through the threshold ${doors.length} times`);
    else if (doors[0].newText !== ctx.newText) wrong.push("the threshold was not shown what she just wrote");
    if (order.includes("read") && order.indexOf("threshold") > order.indexOf("read")) wrong.push("her words were read before they went through the threshold");
  }
  if (step.does === "disagree" && order[0] !== "write") wrong.push("her no was not kept before anything else");
  return wrong;
}

// ---- running --------------------------------------------------------------------------------

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const withWhy = !args.includes("--no-why");
const showAll = args.includes("--show");

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
const onUsage = (u: Usage) => {
  usage.calls++;
  usage.input += u.input_tokens;
  usage.output += u.output_tokens;
  usage.cacheRead += u.cache_read_input_tokens ?? 0;
  usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
};
// Patient settings for a batch run; the live site uses its own shorter ones.
const real = anthropicModel(data, { client: new Anthropic({ timeout: 90_000, maxRetries: 4 }), onUsage });

type StepResult = {
  step: Step;
  band: Band;
  ok: boolean;
  got: string;
  wrong: string[];
  ms: number;
  result?: TurnResult;
  why?: string;
};

async function runCase(c: Case): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const account = c.steps[0].text;
  const turns: Turn[] = [];
  const events: Event[] = [];
  const collector = new MemoryCollector(events);
  const deps = { model: logged(real, events), collector, secret: TEST_SECRET };
  let passed: string | undefined;
  let prev: TurnResult | undefined;

  for (const step of c.steps) {
    const base = { step, band: c.band, ms: 0 };
    // What she does next only makes sense after the card that offers it.
    if (step.does === "agree") {
      const before = events.length;
      const ok = prev?.kind === "reading"; // agreeing makes no call and keeps nothing
      out.push({ ...base, ok, got: ok ? "settled" : "no reading to agree with", wrong: events.length !== before ? ["agree did something"] : [] });
      break;
    }
    let rejected: string | undefined;
    let note: string | undefined;
    if (step.does === "more") {
      if (prev?.kind !== "ask") {
        out.push({ ...base, ok: false, got: "not reached: the step before did not ask", wrong: [] });
        break;
      }
      turns.push({ type: "more", text: step.text });
    }
    if (step.does === "disagree") {
      if (prev?.kind !== "reading") {
        out.push({ ...base, ok: false, got: "not reached: the step before gave no reading", wrong: [] });
        break;
      }
      rejected = prev.lead;
      note = step.text === "(no note)" ? undefined : step.text;
      turns.push({ type: "disagree", cog: rejected, note });
    }

    const eventsBefore = events.length;
    const recordsBefore = collector.records.length;
    const started = Date.now();
    const request = { band: c.band, account, turns: [...turns], passed };
    try {
      const result = await runTurn(request, data, deps);
      const ms = Date.now() - started;
      const words = [account, ...turns.flatMap((t) => (t.type === "more" ? [t.text] : t.note ? [t.note] : []))];
      const wrong = structure(step, result, {
        events: events.slice(eventsBefore),
        newRecords: collector.records.slice(recordsBefore),
        statement: words.join("\n\n"),
        newText: step.does === "disagree" ? note : step.text,
        rejected,
        note,
      });
      const ok = matches(step.expect, result);
      let why: string | undefined;
      if (!ok && withWhy && result.kind !== "beyond") {
        // A second look at a miss, asking the model which words decided it. Never scored.
        const again = await runTurn(request, data, { ...deps, model: real, collector: new MemoryCollector() }, { debug: true }).catch(() => undefined);
        why = again?.read?.why ? `(second look: ${got(again)}) ${again.read.why}` : undefined;
      }
      out.push({ ...base, ok, got: got(result), wrong, ms, result, why });
      prev = result;
      passed = "passed" in result ? result.passed : undefined;
    } catch (e) {
      const label =
        e instanceof ModelUnavailable || e instanceof ModelBusy ? e.detail : e instanceof TurnLimit ? `limit ${e.limit}` : `error ${(e as Error).message}`;
      out.push({ ...base, ok: false, got: label, wrong: [], ms: Date.now() - started });
      break;
    }
  }
  return out;
}

const cases = parseTests().filter((c) => !only || c.steps.some((s) => s.text.toLowerCase().includes(only.toLowerCase())));
const started = Date.now();
const results: StepResult[][] = new Array(cases.length);
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runCase(cases[i]);
    }
  }),
);
const all = results.flat();

// ---- the report ---------------------------------------------------------------------------

for (const r of all) {
  const indent = r.step.does === "open" ? "" : "    ";
  const probe = r.step.probe ? "  (line probe)" : "";
  console.log(`${indent}${r.ok ? "✓" : "✗"} [${r.band}] ${r.step.does === "open" ? "" : `${r.step.does}: `}expected ${r.step.expect}, got ${r.got}${probe}  ${r.step.text}`);
  if ((!r.ok || showAll) && r.result?.kind === "reading") console.log(`${indent}    shown: ${r.result.text}`);
  if (r.why) console.log(`${indent}    why: ${r.why}`);
  for (const w of r.wrong) console.log(`${indent}    ! ${w}`);
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const tally = (rows: StepResult[]) => `${rows.filter((r) => r.ok).length}/${rows.length} (${pct(rows.filter((r) => r.ok).length, rows.length)})`;
const group = (key: (r: StepResult) => string) => {
  const groups = new Map<string, StepResult[]>();
  for (const r of all) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups].map(([k, rows]) => `${k} ${tally(rows)}`).join(" · ");
};

console.log(`\nScore: ${tally(all)}  (bar: 90%)`);
console.log(`By what should come back: ${group((r) => category(r.step))}`);
console.log(`By band: ${group((r) => r.band)}`);
console.log(`Line probes (Luna's guesses, for Kim to settle): ${tally(all.filter((r) => r.step.probe))}`);
console.log(`Without the line probes: ${tally(all.filter((r) => !r.step.probe))}`);

const readings = all.flatMap((r) => (r.result?.kind === "reading" ? [r.result] : []));
const sizes = new Map<number, number>();
for (const r of readings) sizes.set(1 + r.others.length, (sizes.get(1 + r.others.length) ?? 0) + 1);
console.log(`Cogs named per reading: ${[...sizes].sort((x, y) => x[0] - y[0]).map(([n, c]) => `${n} cog${n > 1 ? "s" : ""} × ${c}`).join(", ") || "none"}`);
const falseSeveral = all.filter((r) => r.step.expect.startsWith("one:") && r.result?.kind === "reading" && r.result.others.length > 0).length;
console.log(`Named more than one where exactly one was expected: ${falseSeveral}`);
const asks = all.flatMap((r) => (r.result?.kind === "ask" ? [r.result.reason] : []));
console.log(`Asks: topic only ${asks.filter((x) => x === "topic_only").length}, intent needed ${asks.filter((x) => x === "intent_needed").length}, no cog ${asks.filter((x) => x === "nocog").length}`);
const fallbacks = readings.filter((r) => r.paraphrase?.fallback).length;
console.log(`Fallback meaning used: ${fallbacks}${fallbacks > 2 ? "  (more than 2: the read prompt needs tuning)" : ""}`);
const structural = all.reduce((n, r) => n + r.wrong.length, 0);
console.log(`Structural problems: ${structural}`);

const times = all.map((r) => r.ms).filter(Boolean).sort((x, y) => x - y);
const at = (p: number) => (times.length ? (times[Math.min(times.length - 1, Math.floor(p * times.length))] / 1000).toFixed(1) : "0");
// Published rates per million tokens: $4 in, $20 out; a cache write costs 1.25x input, a cache read $0.20.
const cost = (usage.input * 4 + usage.cacheWrite * 5 + usage.cacheRead * 0.2 + usage.output * 20) / 1e6;
console.log(`Time per turn: p50 ${at(0.5)}s, p95 ${at(0.95)}s. Whole run ${((Date.now() - started) / 1000).toFixed(0)}s.`);
console.log(`Model calls: ${usage.calls}. Tokens: ${usage.input} in, ${usage.cacheRead} cached, ${usage.cacheWrite} cache-written, ${usage.output} out. Estimated cost $${cost.toFixed(2)}.`);
