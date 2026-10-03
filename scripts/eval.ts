// Sends every account in data/tests.md through the same turn a teacher gets, with the real
// model, and compares what comes back with what the file says should.
// Run: npm run eval            (spends real API money: about 180 model calls)
//      npm run eval -- --only "carpet"     only accounts containing that text
//      npm run eval -- --section "With her teaching"   only accounts under a "## " heading containing that text
//      npm run eval -- --times 3           run each selected account that many times and say which rows changed
//      npm run eval -- --others two        as if the "others needed:" line said that word (no file is changed);
//                                          runs only the section written for it, "## If the line says two"
//      npm run eval -- --no-why            skip the second look at misses
//      npm run eval -- --show              print every reading in full, not only the misses
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { BANDS, type Band } from "../lib/bands";
import { enough, HOW_MANY, type HowMany, loadData } from "../lib/data";
import { anthropicModel, conditionCog, ModelBusy, ModelUnavailable, sortIds, type Usage } from "../lib/model";
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

const args = process.argv.slice(2);
// The word on the "others needed:" line: the file's own, or the one asked for with --others.
// The override lives in memory for this run only.
const onFile = loadData();
const othersAsked = args.includes("--others") ? args[args.indexOf("--others") + 1] : undefined;
if (othersAsked !== undefined && !(HOW_MANY as readonly string[]).includes(othersAsked)) {
  throw new Error(`--others takes ${HOW_MANY.map((w) => `"${w}"`).join(" or ")} (found "${othersAsked}")`);
}
const data = othersAsked
  ? { ...onFile, cogs: onFile.cogs.map((c) => (c.condition ? { ...c, condition: { ...c.condition, othersNeeded: othersAsked as HowMany } } : c)) }
  : onFile;
const copy = data.copy;
const cogName = (id: string) => data.cogs.find((c) => c.id === id)?.name ?? id;
const cogIds = data.cogs.map((c) => c.id);
const beyondIds = data.beyond.map((b) => b.id);
// The cogs an account can be sorted to, and the one it never is.
const placeIds = sortIds(data);
const condition = conditionCog(data);
const citeLeadIn = copy["paraphrase.cite"].split("{")[0].trim();

// ---- reading data/tests.md -----------------------------------------------------------------

type Step = {
  does: "open" | "more" | "disagree" | "agree";
  expect: string;
  excludes: string[]; // [!word]: must not appear in what she is shown
  includes: string[]; // [+words]: must appear in what she is shown
  text: string;
  probe?: string; // the label after "# line probe", or "no label"
  line: number;
};
type Case = { band: Band; section: string; steps: Step[] };

function parseStep(rest: string, does: Step["does"], line: number): Step {
  const marker = rest.match(/\s#\s*line probe(?::\s*(.*?))?\s*$/);
  const probe = marker ? marker[1] || "no label" : undefined;
  let body = rest.replace(/\s+#[^#]*$/, "").trim();
  const tag = body.match(/^\[([^\]]+)\]\s*/);
  if (!tag) throw new Error(`data/tests.md line ${line}: missing [what should come back]`);
  const expect = tag[1];
  body = body.slice(tag[0].length);
  const excludes: string[] = [];
  const includes: string[] = [];
  for (let m = body.match(/^\[([!+])([^\]]+)\]\s*/); m; m = body.match(/^\[([!+])([^\]]+)\]\s*/)) {
    (m[1] === "!" ? excludes : includes).push(m[2]);
    body = body.slice(m[0].length);
  }
  const [kind, arg] = expect.split(":");
  if (kind === "one" && arg === condition.id) {
    throw new Error(`data/tests.md line ${line}: "[${expect}]" cannot come back. ${condition.name} only ever leads with other cogs named after it: write [several:${condition.id}]`);
  }
  const known =
    (["ask", "nocog", "several", "settled"].includes(expect)) ||
    (["one", "several", "not"].includes(kind) && cogIds.includes(arg)) ||
    (kind === "beyond" && beyondIds.includes(arg)) ||
    cogIds.includes(expect);
  if (!known) throw new Error(`data/tests.md line ${line}: "[${expect}]" is not something the system can return`);
  return { does, expect, excludes, includes, text: body.trim(), probe, line };
}

function parseTests(): Case[] {
  const cases: Case[] = [];
  let section = "";
  fs.readFileSync(path.join(process.cwd(), "data", "tests.md"), "utf8")
    .split("\n")
    .forEach((raw, i) => {
      const heading = raw.match(/^## (.+)$/);
      if (heading) section = heading[1].trim();
      const top = raw.match(/^- \[([^\]]+)\] (.+)$/);
      const next = raw.match(/^ {2}- \[(more|disagree|agree)\] (.+)$/);
      if (top) {
        if (!BANDS.includes(top[1] as Band)) throw new Error(`data/tests.md line ${i + 1}: "${top[1]}" is not a band`);
        cases.push({ band: top[1] as Band, section, steps: [parseStep(top[2], "open", i + 1)] });
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

  // The sort and the marks can only hold cogs an account can be sorted to.
  if (r.read) {
    const stray = [...r.read.cogs, ...(r.read.withTeaching ?? [])].filter((id) => !placeIds.includes(id));
    if (stray.length) wrong.push(`the sort or its marks hold ${stray.join(", ")}, which no account is sorted to`);
  }
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
    // After a no with words, a cog may come back if her words point back to it. It never comes
    // back alone and marked as alongside her teaching: with "one" that leads, and otherwise she
    // is asked.
    if (step.does === "disagree" && ctx.note && r.lead === ctx.rejected && r.others.length === 0 && r.read?.teaching === true && (r.read.withTeaching ?? []).includes(r.lead)) {
      wrong.push("the reading she said no to came straight back alone, marked as alongside her teaching");
    }
    // The cog that is never sorted to: it only ever leads, only when her teaching is named and
    // what the line asks for is named after it, and with nothing of Missouri's cited.
    if (r.others.includes(condition.id)) wrong.push(`${condition.id} is named as one of the others`);
    if (r.lead === condition.id) {
      const marks = r.others.filter((id) => (r.read?.withTeaching ?? []).includes(id)).length;
      if (r.read?.teaching !== true) wrong.push(`${condition.id} leads and the reading step did not say teaching of hers is named`);
      if (!enough(condition.condition.othersNeeded, { sorted: r.others.length, marked: marks })) {
        wrong.push(`${condition.id} leads with ${r.others.length} cogs named after it, ${marks} of them marked; the line says "${condition.condition.othersNeeded}"`);
      }
      if (r.text.includes(citeLeadIn)) wrong.push(`${condition.id} leads and the text cites Missouri ("${citeLeadIn}")`);
    }
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

const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const onlySection = args.includes("--section") ? args[args.indexOf("--section") + 1] : undefined;
const timesAsked = args.includes("--times") ? Number(args[args.indexOf("--times") + 1]) : 1;
const times = Number.isInteger(timesAsked) && timesAsked >= 1 ? timesAsked : 1;
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
  missing?: string[]; // [+words] that were not in what she was shown
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
      const said = result.kind === "reading" ? `${result.text} ${result.question}` : result.sentence;
      const missing = step.includes.filter((words) => !said.includes(words));
      const ok = matches(step.expect, result) && missing.length === 0;
      let why: string | undefined;
      if (!ok && withWhy && result.kind !== "beyond") {
        // A second look at a miss, asking the model which words decided it. Never scored.
        const again = await runTurn(request, data, { ...deps, model: real, collector: new MemoryCollector() }, { debug: true }).catch(() => undefined);
        why = again?.read?.why ? `(second look: ${got(again)}) ${again.read.why}` : undefined;
      }
      out.push({ ...base, ok, got: got(result), wrong, missing, ms, result, why });
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

// A section headed "If the line says <word>" holds what should come back under that word. It
// runs only when that word is in force. Every other section is written for the word in the
// file, and runs only when that one is.
const inForce = condition.condition.othersNeeded;
const writtenFor = (section: string) => section.match(/^If the line says "?(\w+)"?/i)?.[1].toLowerCase() ?? conditionCog(onFile).condition.othersNeeded;
const cases = parseTests()
  .filter((c) => writtenFor(c.section) === inForce)
  .filter((c) => !only || c.steps.some((s) => s.text.toLowerCase().includes(only.toLowerCase())))
  .filter((c) => !onlySection || c.section.toLowerCase().includes(onlySection.toLowerCase()));
const started = Date.now();
// runs[t][i] is what case i did on its run number t.
const runs: StepResult[][][] = Array.from({ length: times }, () => new Array(cases.length));
const jobs = runs.flatMap((_, t) => cases.map((_, i) => ({ t, i })));
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const { t, i } = jobs[next++];
      runs[t][i] = await runCase(cases[i]);
    }
  }),
);
const all = runs.flat(2);

// ---- the report ---------------------------------------------------------------------------

const ids = (list: string[] | undefined) => `[${(list ?? []).join(", ")}]`;
const changed: string[] = [];
cases.forEach((c, i) => {
  c.steps.forEach((step, j) => {
    const across = runs.map((run) => run[i]?.[j]);
    const done = across.flatMap((r) => (r ? [r] : []));
    if (!done.length) return;
    const indent = step.does === "open" ? "" : "    ";
    const probe = step.probe ? `  (line probe: ${step.probe})` : "";
    const matched = done.filter((r) => r.ok).length;
    const gots = [...new Set(done.map((r) => r.got))];
    if (gots.length > 1) changed.push(`line ${step.line}: ${gots.join(" | ")}`);
    const repeat = times > 1 ? `  [matched ${matched} of ${done.length}${gots.length > 1 ? ", not the same every time" : ""}]` : "";
    console.log(`${indent}${matched === done.length ? "✓" : "✗"} [${c.band}] ${step.does === "open" ? "" : `${step.does}: `}expected ${step.expect}, got ${gots.join(" | ")}${probe}${repeat}  ${step.text}`);
    across.forEach((r, t) => {
      if (!r) return;
      const run = times > 1 ? `run ${t + 1}: ` : "";
      const read = r.result?.read;
      if (read) console.log(`${indent}    ${run}sorted to ${ids(read.cogs)} · her teaching named: ${read.teaching ? "yes" : "no"} · with her teaching ${ids(read.withTeaching)}`);
      if ((!r.ok || showAll) && r.result?.kind === "reading") console.log(`${indent}    ${run}shown: ${r.result.text}`);
      for (const words of r.missing ?? []) console.log(`${indent}    ${run}not shown: "${words}"`);
      if (r.why) console.log(`${indent}    ${run}why: ${r.why}`);
      for (const w of r.wrong) console.log(`${indent}    ${run}! ${w}`);
    });
  });
});

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const tally = (rows: StepResult[]) => `${rows.filter((r) => r.ok).length}/${rows.length} (${pct(rows.filter((r) => r.ok).length, rows.length)})`;
const group = (key: (r: StepResult) => string) => {
  const groups = new Map<string, StepResult[]>();
  for (const r of all) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups].map(([k, rows]) => `${k} ${tally(rows)}`).join(" · ");
};

if (othersAsked) console.log(`\nRun as if the line said "others needed: ${inForce}". Only the accounts written for that word were run.`);
if (times > 1) console.log(`${othersAsked ? "" : "\n"}Each account was run ${times} times; every count below adds the runs together. Rows that were not the same every time: ${changed.length}${changed.length ? `\n  ${changed.join("\n  ")}` : ""}`);
console.log(`${times > 1 || othersAsked ? "" : "\n"}Score: ${tally(all)}  (bar: 90%)`);
console.log(`By what should come back: ${group((r) => category(r.step))}`);
console.log(`By band: ${group((r) => r.band)}`);
console.log(`Line probes (Luna's guesses, for Kim to settle): ${tally(all.filter((r) => r.step.probe))}`);
for (const label of new Set(all.flatMap((r) => (r.step.probe ? [r.step.probe] : [])))) {
  console.log(`  line probe "${label}": ${tally(all.filter((r) => r.step.probe === label))}`);
}
console.log(`Without the line probes: ${tally(all.filter((r) => !r.step.probe))}`);

const readings = all.flatMap((r) => (r.result?.kind === "reading" ? [r.result] : []));
const sizes = new Map<number, number>();
for (const r of readings) sizes.set(1 + r.others.length, (sizes.get(1 + r.others.length) ?? 0) + 1);
console.log(`Cogs named per reading: ${[...sizes].sort((x, y) => x[0] - y[0]).map(([n, c]) => `${n} cog${n > 1 ? "s" : ""} × ${c}`).join(", ") || "none"}`);
// The cog that is never sorted to. A mark is the reading step saying a cog it listed was on her
// at the same moment as her own teaching. A mark with no teaching named counts for nothing.
const ledByCondition = readings.filter((r) => r.lead === condition.id).length;
const withMark = all.filter((r) => r.result?.read?.teaching === true && (r.result.read.withTeaching ?? []).length > 0);
const named = all.filter((r) => r.result?.read?.teaching === true).length;
const expectsCondition = (step: Step) => step.expect === condition.id || step.expect === `several:${condition.id}`;
console.log(
  `Led by ${condition.name}: ${ledByCondition} readings (others needed: "${condition.condition.othersNeeded}"). ` +
    `Rows where the reading step said her teaching is named: ${named}. ` +
    `Rows where a cog was marked as alongside her teaching: ${withMark.length}; ` +
    `of those, rows not expected to be led by it: ${withMark.filter((r) => !expectsCondition(r.step)).length}.`,
);
const falseSeveral = all.filter((r) => r.step.expect.startsWith("one:") && r.result?.kind === "reading" && r.result.others.length > 0).length;
console.log(`Named more than one where exactly one was expected: ${falseSeveral}`);
const asks = all.flatMap((r) => (r.result?.kind === "ask" ? [r.result.reason] : []));
console.log(`Asks: topic only ${asks.filter((x) => x === "topic_only").length}, intent needed ${asks.filter((x) => x === "intent_needed").length}, no cog ${asks.filter((x) => x === "nocog").length}`);
const fallbacks = readings.filter((r) => r.paraphrase?.fallback).length;
console.log(`Fallback meaning used: ${fallbacks}${fallbacks > 2 ? "  (more than 2: the read prompt needs tuning)" : ""}`);
const structural = all.reduce((n, r) => n + r.wrong.length, 0);
console.log(`Structural problems: ${structural}`);

const took = all.map((r) => r.ms).filter(Boolean).sort((x, y) => x - y);
const at = (p: number) => (took.length ? (took[Math.min(took.length - 1, Math.floor(p * took.length))] / 1000).toFixed(1) : "0");
// Published rates per million tokens: $4 in, $20 out; a cache write costs 1.25x input, a cache read $0.20.
const cost = (usage.input * 4 + usage.cacheWrite * 5 + usage.cacheRead * 0.2 + usage.output * 20) / 1e6;
console.log(`Time per turn: p50 ${at(0.5)}s, p95 ${at(0.95)}s. Whole run ${((Date.now() - started) / 1000).toFixed(0)}s.`);
console.log(`Model calls: ${usage.calls}. Tokens: ${usage.input} in, ${usage.cacheRead} cached, ${usage.cacheWrite} cache-written, ${usage.output} out. Estimated cost $${cost.toFixed(2)}.`);
