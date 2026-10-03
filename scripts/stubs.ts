// Checks of the turn itself with a scripted stand-in for the model, so they cost nothing.
// Run: npm run check
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlobError } from "@vercel/blob";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Settled } from "../app/Settled";
import { BlobCollector, type Collector, FileCollector, NoCollector, recordName } from "../lib/collector";
import { type Data, drafts, enough, HOW_MANY, type HowMany, loadData, parseCogText } from "../lib/data";
import { MAX_CHARS, MAX_MEANING_CHARS, MAX_TURNS, RATE_WINDOW_MS, RATE_WINDOW_TURNS, RETRY_LIMITS } from "../lib/limits";
import { conditionCog, ModelBusy, ModelUnavailable, type ReadOutput, readUser, sortIds, thresholdUser } from "../lib/model";
import { compose } from "../lib/paraphrase";
import { type Offered, sign, verify } from "../lib/passed";
import { createLimiter } from "../lib/rate";
import { parseHeader, parseSections } from "../lib/sections";
import { fill } from "../lib/slots";
import { runTurn, steps, toResponse, type Turn, TurnLimit, type TurnRequest, type TurnResult } from "../lib/turn";
import { count, type Event, logged, MemoryCollector, NO_REFUSAL, stubModel, TEST_SECRET } from "./harness";

const data = loadData();
const copy = data.copy;
const places = sortIds(data); // the cogs an account can be sorted to
const [a, b, c] = places; // any three of them
const k = conditionCog(data).id; // the one cog an account is never sorted to
const cogOf = (id: string) => data.cogs.find((c) => c.id === id)!;
const beyondId = data.beyond[0].id;

// The turn logs a fixed label when it falls back to a cog's authored clause. Not news here.
console.warn = () => {};

let failed = 0;
let passedCount = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passedCount++;
  else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`);
  }
}

// A scripted read. Unless a check says otherwise, the stand-in answers that her teaching is
// named exactly when it marks a cog as alongside it.
const present = (
  cogs: string[],
  meaning = "the starting place is what you described",
  withTeaching: string[] = [],
  withTeachingMeaning = "",
  teaching = withTeaching.length > 0,
): ReadOutput => ({ situation: "present", cogs, teaching, withTeaching, meaning, withTeachingMeaning });

// A turn's surroundings for one check: a scripted model, a collector in memory, and one
// log of everything that happened, in order.
function rig(model: Parameters<typeof stubModel>[0], collector?: Collector) {
  const events: Event[] = [];
  const memory = new MemoryCollector(events);
  const deps = { model: logged(stubModel(model), events), collector: collector ?? memory, secret: TEST_SECRET };
  return { events, collector: memory, deps };
}
const open = (account: string): TurnRequest => ({ band: "3-5", account, turns: [] });
// A later turn, carrying the signature the server would have given with the thing she is
// answering: an ask before a reply, a reading led by that cog before a "no".
const answered = (t: Turn): Offered => (t.type === "more" ? "ask" : `lead:${t.cog}`);
const then = (account: string, turns: Turn[]): TurnRequest => ({
  band: "3-5",
  account,
  turns,
  passed: sign(TEST_SECRET, "3-5", steps(account, turns.slice(0, -1)), answered(turns.at(-1)!)),
});
async function limitOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "no limit";
  } catch (e) {
    return e instanceof TurnLimit ? e.limit : `other error: ${e}`;
  }
}

// --- the three readings ---------------------------------------------------------------

{
  // A situation that is sorted to no cog: ask, tell her it is held, keep it.
  const r = rig({ threshold: { scope: "inside" }, read: present([]) });
  const out = await runTurn(open("An account."), data, r.deps);
  check("no cog -> ask", out.kind === "ask" && out.reason === "nocog");
  check("no cog -> held", out.held === true);
  check(
    "no cog -> one record, verbatim",
    r.collector.records.length === 1 &&
      r.collector.records[0].statement === "An account." &&
      r.collector.records[0].fellThrough === "no cog",
  );
  check("no cog -> the authored ask", out.kind === "ask" && out.sentence === copy["ask.sentence"]);
}
{
  // Several cogs: the first leads, repeats are dropped, the rest are named. No ask, no record.
  const r = rig({ threshold: { scope: "inside" }, read: present([a, a, b]) });
  const out = await runTurn(open("An account."), data, r.deps);
  check("several -> lead and others", out.kind === "reading" && out.lead === a && out.others.join() === b);
  const names = data.cogs.filter((c) => c.id === a || c.id === b).map((c) => c.name);
  check("several -> both names in the text", out.kind === "reading" && names.every((n) => out.text.includes(n)));
  check("several -> nothing kept", r.collector.records.length === 0 && out.held === false);
}
{
  // A topic: ask. Whatever cog the model listed anyway is ignored, and nothing is kept.
  const r = rig({ threshold: { scope: "inside" }, read: { situation: "topic_only", cogs: [a], meaning: "x" } });
  const out = await runTurn(open("a topic"), data, r.deps);
  check("topic -> ask, no cog", out.kind === "ask" && out.reason === "topic_only" && !("lead" in out));
  check("topic -> nothing kept", r.collector.records.length === 0 && out.held === false);
}
{
  const r = rig({ threshold: { scope: "inside" }, read: { situation: "intent_needed", cogs: [], meaning: "" } });
  const out = await runTurn(open("a label"), data, r.deps);
  check("intent needed -> ask, nothing kept", out.kind === "ask" && out.held === false && r.collector.records.length === 0);
}

// --- the threshold ----------------------------------------------------------------------

{
  // Beyond: the authored sentence, held, one record, and no reading is ever built.
  const r = rig({ threshold: { scope: beyondId } });
  const out = await runTurn(open("Something beyond."), data, r.deps);
  check("beyond -> authored sentence", out.kind === "beyond" && out.sentence === data.beyond[0].sentence);
  check("beyond -> no read call", count(r.events, "read") === 0);
  const wire = toResponse(out) as Record<string, unknown>;
  check("beyond -> no cog, text or token", !["lead", "others", "text", "cite", "passed"].some((k) => k in wire));
  check(
    "beyond -> held, one record",
    out.held === true &&
      r.collector.records.length === 1 &&
      r.collector.records[0].statement === "Something beyond." &&
      r.collector.records[0].fellThrough === "threshold",
  );
}
{
  // Her reply to "what was happening" goes through the door again, with her earlier words as context.
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  await runTurn(then("a topic", [{ type: "more", text: "What happened." }]), data, r.deps);
  const call = r.events.find((e) => e.what === "threshold");
  check(
    "more -> threshold sees all her words",
    call?.what === "threshold" && call.input.earlier.join() === "a topic" && call.input.newText === "What happened.",
  );
}
{
  // A reply that turns out to be beyond stops there too.
  const r = rig({ threshold: { scope: beyondId } });
  const out = await runTurn(then("a topic", [{ type: "more", text: "Something beyond." }]), data, r.deps);
  check("more, beyond -> stop", out.kind === "beyond" && count(r.events, "read") === 0);
  check("more, beyond -> record has all her words", r.collector.records[0]?.statement === "a topic\n\nSomething beyond.");
}

// --- calibrate: her answer is new evidence ----------------------------------------------

{
  // "Mostly disagree" with words: kept before anything else, then through the door, then read.
  const r = rig({ threshold: { scope: "inside" }, read: present([b]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "Not that." }]), data, r.deps);
  const order = r.events.map((e) => e.what).join();
  check("disagree with words -> kept, then threshold, then read", order === "write,threshold,read", order);
  const call = r.events.find((e) => e.what === "threshold");
  check(
    "disagree with words -> the threshold sees the note as what she just wrote",
    call?.what === "threshold" && call.input.earlier.join() === "An account." && call.input.newText === "Not that." && call.input.afterNo === true,
  );
  check(
    "disagree with words -> the model is told what the note answers",
    call?.what === "threshold" && thresholdUser(call.input).includes("said mostly disagree") && !thresholdUser({ earlier: [], newText: "x" }).includes("disagree"),
  );
  check(
    "disagree -> record names the cog and holds account and note",
    r.collector.records.length === 1 &&
      r.collector.records[0]?.fellThrough === `${a}, she said no` &&
      r.collector.records[0]?.statement === "An account.\n\nNot that.",
  );
  check("disagree -> new reading, held", out.kind === "reading" && out.lead === b && out.held === true);
}
{
  // What she writes with a "no" can sit beyond. Then the door holds: no reading is built.
  const r = rig({ threshold: { scope: beyondId } });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "Something beyond." }]), data, r.deps);
  check("disagree, note beyond -> the authored sentence", out.kind === "beyond" && out.sentence === data.beyond[0].sentence);
  check("disagree, note beyond -> no read call", count(r.events, "read") === 0);
  check(
    "disagree, note beyond -> her no and the threshold are both kept, in that order",
    out.held === true &&
      r.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no|threshold` &&
      r.collector.records.every((x) => x.statement === "An account.\n\nSomething beyond."),
  );
  const wire = toResponse(out) as Record<string, unknown>;
  check("disagree, note beyond -> no cog, text or token", !["lead", "others", "text", "cite", "passed"].some((k) => k in wire));
}
{
  // The same cog may come back when she wrote words and they point to it.
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "Well, it is that." }]), data, r.deps);
  check("disagree with words -> same cog allowed", out.kind === "reading" && out.lead === a);
}
{
  // Words with her "no", and then nothing to land on: ask. Her no is the one record. The
  // account did find a cog, so it is not also filed as finding none.
  const r = rig({ threshold: { scope: "inside" }, read: present([]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "No, that's not it." }]), data, r.deps);
  check("disagree with words, nothing fits -> ask", out.kind === "ask" && out.reason === "after_no");
  check(
    "disagree with words, nothing fits -> one record, held",
    out.held === true && r.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no`,
  );
}
{
  // A "no" with no words: the identical reading is not available again, and the door is not
  // run because nothing new came in.
  const r = rig({ read: present([a]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), data, r.deps);
  check("bare no, same lead -> ask", out.kind === "ask" && out.reason === "after_no");
  check(
    "bare no, same lead -> one record, held",
    out.held === true && r.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no`,
  );
  check("bare no -> no threshold call", count(r.events, "threshold") === 0 && r.events.map((e) => e.what).join() === "write,read");
  const read = r.events.find((e) => e.what === "read");
  check("bare no -> the model is told", read?.what === "read" && read.input.bareNo === a);
}
{
  // The model led with the cog she just refused anyway, and named another. Only the refused
  // one is removed; the other still fits and leads, with its own authored clause.
  const r = rig({ read: present([a, b], "the starting place is a clause written for the first cog") });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), data, r.deps);
  const lead = data.cogs.find((c) => c.id === b)!;
  check("bare no, refused cog first and another named -> the other leads", out.kind === "reading" && out.lead === b && out.others.length === 0);
  check(
    "bare no, lead changed -> that cog's own clause, not the one written for the refused cog",
    out.kind === "reading" && out.text.includes(lead.fallbackMeaning) && !out.text.includes("written for the first cog"),
  );
  check("bare no, another fits -> one record", r.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no`);
}
{
  // The refused cog is not named again on that turn, as lead or as one of the others.
  const r = rig({ read: present([b, a]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), data, r.deps);
  const refused = data.cogs.find((c) => c.id === a)!;
  check("bare no, refused cog listed second -> not named", out.kind === "reading" && out.lead === b && out.others.length === 0 && !out.text.includes(refused.name));
}
{
  const r = rig({ read: present([b]) });
  const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "   " }]), data, r.deps);
  check("bare no, other lead -> reading", out.kind === "reading" && out.lead === b && r.collector.records.length === 1);
  check("blank note is no note", r.collector.records[0]?.statement === "An account." && count(r.events, "threshold") === 0);
}

// --- the paraphrase frame ---------------------------------------------------------------

for (const [label, meaning] of [
  ["blank", "   "],
  ["too long", "x".repeat(MAX_CHARS)],
  ["a question", "have you tried a seating chart?"],
] as const) {
  const r = rig({ threshold: { scope: "inside" }, read: present([a], meaning) });
  const out = await runTurn(open("An account."), data, r.deps);
  const cog = data.cogs.find((c) => c.id === a)!;
  check(
    `meaning ${label} -> the cog's fallback, frame whole`,
    out.kind === "reading" &&
      out.paraphrase?.fallback === true &&
      out.text.includes(` issue. In this model that means ${cog.fallbackMeaning}. `) &&
      out.text.includes(out.cite) &&
      out.question === copy["paraphrase.question"],
  );
}
{
  const tidy = compose([data.cogs[0]], "  In this model that means The starting place is   the line.  ", copy);
  check("meaning is tidied into the frame", tidy.sentences.meaning === "In this model that means the starting place is the line.");
}
{
  // Several: each other cog gets the authored sentence to itself. The names hold commas and
  // "&", so two of them joined by a word cannot be told apart.
  const [lead, ...rest] = places.map(cogOf);
  const p = compose([lead, ...rest], "the starting place is this", copy);
  const each = rest.map((c) => fill(copy["paraphrase.others"], { name: c.name }));
  check("others -> one authored sentence per cog", p.sentences.others === each.join(" ") && each.every((sentence) => p.text.includes(sentence)));
  check("others -> no two names joined in one sentence", !rest.some((x) => rest.some((y) => x !== y && p.text.includes(`${x.name} and ${y.name}`))));
  check("others -> the frame leaves nothing unfilled", !/[{}]/.test(p.text));
  check("one cog -> no others sentence", compose([lead], "the starting place is this", copy).sentences.others === "");
}
{
  // After "mostly agree" the whole reading stays on the page: the lead, the meaning, the
  // citation and every other cog that was named.
  const r = rig({ threshold: { scope: "inside" }, read: present(places, "the starting place is the thing you described") });
  const out = await runTurn(open("An account."), data, r.deps);
  const page = out.kind === "reading" ? renderToStaticMarkup(createElement(Settled, { text: out.text, copy })).replaceAll("&amp;", "&").replaceAll("&#x27;", "'") : "";
  const named = places.map(cogOf);
  check("settled card -> every cog that was named is still shown", named.every((c) => page.includes(c.name)), page);
  check(
    "settled card -> the meaning, the citation and the closing line are shown",
    out.kind === "reading" && page.includes("the starting place is the thing you described") && page.includes(out.cite) && page.includes(copy["settled.line"]),
  );
  check("settled card -> the lead is named once", page.split(named[0].name).length === 2);
}
for (const cog of data.cogs) {
  const p = compose([cog], "the starting place is this", copy);
  const article = /^[aeiou]/i.test(cog.name) ? "an" : "a";
  check(`${cog.id} frame`, p.text.startsWith(`This sounds mostly like ${article} ${cog.name} issue. In this model that means `));
  check(`${cog.id} cite`, cog.citeSentence ? p.cite === cog.citeSentence : p.cite === `That reading comes from ${cog.cite}.`);
  check(`${cog.id} question`, p.question === "Do you mostly agree or disagree with that starting point?");
}

// --- after the sort: her teaching and something else on her at the same moment -------------

// The same data with the "others needed:" line set to each word it can hold, so these checks
// stay green whichever word is in the file.
const withRule = (word: HowMany): Data => ({
  ...data,
  cogs: data.cogs.map((c) => (c.condition ? { ...c, condition: { ...c.condition, othersNeeded: word } } : c)),
});
// What came back, as the cogs in the order she would see them, or the ask and its reason.
const shape = (r: TurnResult) =>
  r.kind === "reading" ? [r.lead, ...r.others].join("+") : r.kind === "ask" ? `ask:${r.reason}` : `beyond:${r.area}`;
const citeLeadIn = copy["paraphrase.cite"].split("{")[0].trim(); // "That reading comes from"
const M = "the starting place is a clause written for the first cog";
const WM = "the starting place is a clause written for her teaching and the other thing together";

{
  // The cog that is never sorted to leads only when her teaching is named and what the line
  // asks for is there. "one": one cog that was sorted to, still offered and marked. "two": two
  // cogs sorted to and still offered, at least one of them marked.
  // Each row: the read, then what comes back under each word.
  const rows: [string, ReadOutput, string, string][] = [
    ["one cog, marked", present([a], M, [a], WM), `${k}+${a}`, a],
    ["one cog, not marked", present([a], M), a, a],
    ["two cogs, one marked", present([a, b], M, [a], WM), `${k}+${a}+${b}`, `${k}+${a}+${b}`],
    ["two cogs, the second marked", present([a, b], M, [b], WM), `${k}+${a}+${b}`, `${k}+${a}+${b}`],
    ["two cogs, both marked", present([b, a], M, [a, b], WM), `${k}+${b}+${a}`, `${k}+${b}+${a}`],
    ["three cogs, one marked", present([a, b, c], M, [c], WM), `${k}+${a}+${b}+${c}`, `${k}+${a}+${b}+${c}`],
    // Her teaching named and nothing on her alongside it: never enough, however many were sorted.
    ["two cogs, her teaching named, neither marked", present([a, b], M, [], "", true), `${a}+${b}`, `${a}+${b}`],
    // No teaching of hers named: never, whatever was marked.
    ["one cog marked, no teaching named", present([a], M, [a], WM, false), a, a],
    ["two cogs marked, no teaching named", present([a, b], M, [a, b], WM, false), `${a}+${b}`, `${a}+${b}`],
    ["a mark on a cog that was not listed", present([a], M, [b], WM), a, a],
    ["two cogs, a mark on a third that was not listed", present([a, b], M, [c], WM), `${a}+${b}`, `${a}+${b}`],
    ["nothing sorted, a mark anyway", present([], "", [a], WM), "ask:nocog", "ask:nocog"],
    ["the sort answers with the cog it is never told about", present([k], M, [k], WM), "ask:nocog", "ask:nocog"],
    ["the same, and another cog after it", present([k, a], M), a, a],
  ];
  for (const word of HOW_MANY) {
    for (const [label, read, one, two] of rows) {
      const r = rig({ threshold: { scope: "inside" }, read });
      const out = await runTurn(open("An account."), withRule(word), r.deps);
      check(`${label}, others needed ${word}`, shape(out) === (word === "one" ? one : two), shape(out));
      if (shape(out) === "ask:nocog") {
        check(`${label}, others needed ${word} -> kept as no cog`, r.collector.records.map((x) => x.fellThrough).join("|") === "no cog");
      }
    }
  }
}
{
  // What she is shown when it leads: its own sentence where the citation goes, each cog that
  // was sorted to named in the authored sentence, and nothing of Missouri's cited.
  const r = rig({ threshold: { scope: "inside" }, read: present([a], M, [a], WM) });
  const out = await runTurn(open("An account."), withRule("one"), r.deps);
  const lead = cogOf(k);
  check("it leads -> its own sentence stands where the citation goes", out.kind === "reading" && out.cite === lead.citeSentence && out.text.includes(lead.citeSentence!));
  check("it leads -> no citation of Missouri's", out.kind === "reading" && !out.text.includes(citeLeadIn), citeLeadIn);
  check("it leads -> the cog that was sorted to is named in the authored sentence", out.kind === "reading" && out.text.includes(fill(copy["paraphrase.others"], { name: cogOf(a).name })));
  check("it leads -> the clause written for it is shown, not the one for the first cog", out.kind === "reading" && out.text.includes(WM) && !out.text.includes(M));
  check("it leads -> nothing kept, and she is not asked for more", r.collector.records.length === 0 && out.held === false && out.kind === "reading" && !out.text.includes(copy["ask.sentence"]));
  check("it leads -> the token says it was offered", out.kind === "reading" && out.passed === sign(TEST_SECRET, "3-5", steps("An account.", []), `lead:${k}`));
  const page = out.kind === "reading" ? renderToStaticMarkup(createElement(Settled, { text: out.text, copy })).replaceAll("&amp;", "&").replaceAll("&#x27;", "'") : "";
  check("it leads -> the settled card shows its sentence and every cog named", page.includes(lead.citeSentence!) && page.includes(cogOf(a).name) && page.includes(lead.name), page);

  const two = rig({ threshold: { scope: "inside" }, read: present([b, a], M, [a], WM) });
  const both = await runTurn(open("An account."), withRule("one"), two.deps);
  check(
    "it leads -> every cog that was sorted to is named, marked or not, in the sorter's order",
    both.kind === "reading" && both.paraphrase?.sentences.others === [b, a].map((id) => fill(copy["paraphrase.others"], { name: cogOf(id).name })).join(" "),
  );
}
for (const [label, clause] of [
  ["blank", "  "],
  ["a question", "have you tried splitting the groups?"],
  ["too long", "x".repeat(MAX_MEANING_CHARS + 1)],
] as const) {
  const r = rig({ threshold: { scope: "inside" }, read: present([a], M, [a], clause) });
  const out = await runTurn(open("An account."), withRule("one"), r.deps);
  check(
    `it leads, its clause ${label} -> its own authored clause, never the one for the first cog`,
    out.kind === "reading" && out.lead === k && out.paraphrase?.fallback === true && out.text.includes(cogOf(k).fallbackMeaning) && !out.text.includes(M),
  );
}
{
  // The same, and another cog after it: that cog leads with its own authored clause.
  const r = rig({ threshold: { scope: "inside" }, read: present([k, a], M) });
  const out = await runTurn(open("An account."), data, r.deps);
  check("a cog that leads without being the sorter's first -> its own authored clause", out.kind === "reading" && out.text.includes(cogOf(a).fallbackMeaning) && !out.text.includes(M));
}
for (const word of HOW_MANY) {
  const d = withRule(word);
  const noK: Turn = { type: "disagree", cog: k };
  {
    // "Mostly disagree" to it with no words: her no is kept, the door is not run, and it does
    // not come back. The cogs that were sorted to are offered instead.
    const r = rig({ read: present([a], M, [a], WM) });
    const out = await runTurn(then("An account.", [noK]), d, r.deps);
    check(`${word}: bare no to it -> kept, then read`, r.events.map((e) => e.what).join() === "write,read" && r.collector.records.map((x) => x.fellThrough).join("|") === `${k}, she said no`);
    check(`${word}: bare no to it -> the cog that was sorted to leads, with the model's clause`, shape(out) === a && out.kind === "reading" && out.text.includes(M) && !out.text.includes(cogOf(k).name), shape(out));
    const read = r.events.find((e) => e.what === "read");
    const shownToModel = read?.what === "read" ? readUser(read.input, d) : "";
    check(`${word}: bare no to it -> the model is not told to leave anything out, and never sees its name`, shownToModel !== "" && !shownToModel.includes("out of the list") && !shownToModel.includes(cogOf(k).name) && shownToModel.includes(cogOf(k).actingOn), shownToModel);
  }
  {
    const r = rig({ read: present([], "") });
    const out = await runTurn(then("An account.", [noK]), d, r.deps);
    check(`${word}: bare no to it, nothing sorted -> ask, one record`, shape(out) === "ask:after_no" && r.collector.records.map((x) => x.fellThrough).join("|") === `${k}, she said no`, shape(out));
  }
  {
    // "Mostly disagree" to it with words: the door runs, everything is read again, and it
    // comes back only if the read marks a cog again.
    const r = rig({ threshold: { scope: "inside" }, read: present([a], M, [a], WM) });
    const out = await runTurn(then("An account.", [{ ...noK, note: "It is both at once." }]), d, r.deps);
    check(`${word}: no to it with words -> kept, then threshold, then read`, r.events.map((e) => e.what).join() === "write,threshold,read");
    check(`${word}: no to it with words, marked again`, shape(out) === (word === "one" ? `${k}+${a}` : a), shape(out));
    const r2 = rig({ threshold: { scope: "inside" }, read: present([a], M) });
    const out2 = await runTurn(then("An account.", [{ ...noK, note: "Not that." }]), d, r2.deps);
    check(`${word}: no to it with words, not marked again -> the cog that was sorted to`, shape(out2) === a, shape(out2));
  }
  {
    // A bare no to a cog that was sorted to: that cog is gone on this turn, marked or not.
    const r = rig({ read: present([a], M, [a], WM) });
    const out = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), d, r.deps);
    check(`${word}: bare no to the only cog, marked -> ask`, shape(out) === "ask:after_no", shape(out));
    const r2 = rig({ read: present([a, b], M, [a], WM) });
    const out2 = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), d, r2.deps);
    check(`${word}: bare no to the marked cog, another sorted -> the other, alone`, shape(out2) === b, shape(out2));
    const r3 = rig({ read: present([a, b], M, [a, b], WM) });
    const out3 = await runTurn(then("An account.", [{ type: "disagree", cog: a }]), d, r3.deps);
    check(`${word}: bare no to one of two marked cogs`, shape(out3) === (word === "one" ? `${k}+${b}` : b), shape(out3));
  }
  {
    // She says no to a cog and adds, in words, that she was teaching someone else then. The
    // cog stays (her words point back to it), is marked, and the reading names it.
    const r = rig({ threshold: { scope: "inside" }, read: present([a], M, [a], WM) });
    const out = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "It happens while I am with my group." }]), d, r.deps);
    // With "two" that is not enough, and that cog alone would be the reading she just said
    // no to. It does not come straight back: she is asked, and only her no is kept.
    check(`${word}: no to a cog with words that add her teaching`, shape(out) === (word === "one" ? `${k}+${a}` : "ask:after_no"), shape(out));
    check(`${word}: no to a cog with words -> one record`, r.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no`);
    // The same no where another cog was sorted too: it leads under either word.
    const r3 = rig({ threshold: { scope: "inside" }, read: present([a, b], M, [a], WM) });
    const out3 = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "It happens while I am with my group." }]), d, r3.deps);
    check(`${word}: the same, another cog sorted too`, shape(out3) === `${k}+${a}+${b}`, shape(out3));
    // A no with words where nothing is marked is untouched: the cog may come back if the
    // read says her words point back to it.
    const r4 = rig({ threshold: { scope: "inside" }, read: present([a], M) });
    const out4 = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "Well, it is that." }]), d, r4.deps);
    check(`${word}: no to a cog with words, nothing marked -> that cog may come back`, shape(out4) === a, shape(out4));
    const r5 = rig({ threshold: { scope: "inside" }, read: present([a], M, [a], WM, false) });
    const out5 = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "Well, it is that." }]), d, r5.deps);
    check(`${word}: no to a cog with words, a mark and no teaching named -> that cog may come back`, shape(out5) === a, shape(out5));
    const r2 = rig({ threshold: { scope: "inside" }, read: present([], "") });
    const out2 = await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "It happens while I am with my group." }]), d, r2.deps);
    check(`${word}: the same, nothing sorted -> ask, only her no kept`, shape(out2) === "ask:after_no" && r2.collector.records.map((x) => x.fellThrough).join("|") === `${a}, she said no`, shape(out2));
  }
  {
    // A no to it stands until she writes something new: through a run of wordless nos it
    // does not come back, and after new words the read decides.
    const r = rig({ read: present([a, b], M, [a, b], WM) });
    const out = await runTurn(then("An account.", [noK, { type: "disagree", cog: a }]), d, r.deps);
    check(`${word}: bare no to it, then bare no to a cog -> it stays away`, shape(out) === b, shape(out));
    const r2 = rig({ threshold: { scope: "inside" }, read: present([a, b], M, [b], WM) });
    const out2 = await runTurn(then("An account.", [noK, { type: "disagree", cog: a, note: "It is while I teach." }]), d, r2.deps);
    check(`${word}: bare no to it, then new words -> the read decides again`, shape(out2) === `${k}+${a}+${b}`, shape(out2));
    const r3 = rig({ threshold: { scope: "inside" }, read: present([a, b], M, [b], WM, false) });
    const out3 = await runTurn(then("An account.", [noK, { type: "disagree", cog: a, note: "It is while I teach." }]), d, r3.deps);
    check(`${word}: the same, and the read says no teaching is named -> it stays away`, shape(out3) === `${a}+${b}`, shape(out3));
  }
}
{
  // A "no" to it has to answer a reading it led.
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const offered = then("An account.", [{ type: "disagree", cog: a }]).passed; // came with a reading led by a
  const tangled = await limitOf(runTurn({ band: "3-5", account: "An account.", turns: [{ type: "disagree", cog: k }], passed: offered }, data, r.deps));
  check("a no to it where another cog led -> tangled", tangled === "tangled", tangled);
}
{
  // The one authored line. Any word but the ones the table knows is never enough.
  check("enough: nothing marked is never enough", HOW_MANY.every((w) => !enough(w, { sorted: 3, marked: 0 })));
  check(
    "enough: one and two mean what they say",
    enough("one", { sorted: 1, marked: 1 }) &&
      enough("one", { sorted: 2, marked: 1 }) &&
      !enough("two", { sorted: 1, marked: 1 }) &&
      enough("two", { sorted: 2, marked: 1 }) &&
      enough("two", { sorted: 2, marked: 2 }),
  );
  const plenty = { sorted: 99, marked: 99 };
  check("enough: a word the table does not know never passes", !enough("three", plenty) && !enough("", plenty) && !enough("constructor", plenty));

  const file = (lines: string[]) => [...lines, "", "## Acting on", "x", "", "## Definition", "x", "", "## Fallback meaning", "x", ""].join("\n");
  const head = ["id: 9.9", "name: A name", "status: DRAFT by a test"];
  const named = ["", "## Her teaching is named when", "- x"];
  const counts = [...named, "", "## Counts alongside her teaching when", "- x"];
  const said = (text: string): string => {
    try {
      parseCogText(text, "data/cogs/9.9.md");
      return "loaded";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const sentence = ["", "## Cite sentence", "A sentence."];
  const good = said(file([...head, "others needed: Two", ...sentence, ...counts]));
  check("cog file: a word and its section load", good === "loaded", good);
  for (const [label, text] of [
    ["a word that is not one or two", file([...head, "others needed: three", ...sentence, ...counts])],
    ["no Counts section", file([...head, "others needed: one", ...sentence, ...named])],
    ["no section saying when her teaching is named", file([...head, "others needed: one", ...sentence, "", "## Counts alongside her teaching when", "- x"])],
    ["a cite line and an others needed line", file([...head, "cite: 9.9 A name", "others needed: one", ...counts])],
    ["neither a cite line nor an others needed line", file([...head, ...sentence])],
  ] as const) {
    const message = said(text);
    check(`cog file: ${label} -> stops the load, naming the file`, message.startsWith("data/cogs/9.9.md:"), message);
  }
}

// --- limits of the system ---------------------------------------------------------------

{
  for (const [label, error] of [
    ["declined", new ModelUnavailable("model_refusal none")],
    ["unusable", new ModelUnavailable("model_unparsed max_tokens")],
  ] as const) {
    const r = rig({
      threshold: { scope: "inside" },
      read: async () => {
        throw error;
      },
    });
    let caught: unknown;
    await runTurn(open("An account."), data, r.deps).catch((e) => (caught = e));
    check(`model ${label} -> unavailable, nothing kept`, caught instanceof ModelUnavailable && r.collector.records.length === 0);
  }
  check("limit copy never says the model turned her down", !Object.values(copy).some((s) => NO_REFUSAL.test(s)));
  // "unavailable" also covers outages that have nothing to do with what she wrote, so its
  // sentence may not point at her account, and the page lets her send the same turn again.
  check("unavailable, busy and offline can be tried again", ["unavailable", "busy", "offline"].every((l) => (RETRY_LIMITS as readonly string[]).includes(l)));
  check("no sentence for an outage points at what she wrote", !RETRY_LIMITS.some((l) => /\bthat one\b/i.test(copy[`limits.${l}`])));
}
{
  // Her "no" is kept even when the model then fails, and the page can still say so.
  for (const error of [new ModelUnavailable("model_refusal none"), new ModelBusy("model_busy server")]) {
    const r = rig({
      threshold: { scope: "inside" },
      read: async () => {
        throw error;
      },
    });
    let caught: unknown;
    await runTurn(then("An account.", [{ type: "disagree", cog: a, note: "No." }]), data, r.deps).catch((e) => (caught = e));
    check(
      `${error.constructor.name} on a disagree turn -> held`,
      (caught instanceof ModelUnavailable || caught instanceof ModelBusy) && caught.held === true && r.collector.records.length === 1,
    );
  }
}
{
  // A collector that fails never stops the turn, and she is not told it was kept.
  const broken: Collector = {
    append: async () => {
      throw new Error("down");
    },
  };
  const quiet = console.error;
  console.error = () => {};
  const r = rig({ threshold: { scope: beyondId } }, broken);
  const out = await runTurn(open("Something beyond."), data, r.deps);
  console.error = quiet;
  check("collector down -> turn completes, not held", out.kind === "beyond" && out.held === false);
}
{
  // The collector switched off on purpose: the turn completes, she is not told it was kept,
  // and the log says so once per record that would have been written, with a fixed label.
  const lines: string[] = [];
  const quiet = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.join(" "));
  const r = rig({ threshold: { scope: beyondId } }, new NoCollector());
  const out = await runTurn(open("Something beyond."), data, r.deps);
  console.warn = quiet;
  check("collector off -> turn completes, not held", out.kind === "beyond" && out.held === false);
  check(
    "collector off -> logged once, fixed label, none of her words",
    lines.length === 1 && lines[0] === "collector_off record_not_kept",
    lines.join(" | "),
  );
}
{
  // The blob store saying "already there" is a success: the same record written twice is one record.
  const put = (async () => {
    throw new BlobError("This blob already exists, use allowOverwrite: true to overwrite it.");
  }) as unknown as ConstructorParameters<typeof BlobCollector>[1];
  const r = rig({ threshold: { scope: beyondId } }, new BlobCollector("test/", put));
  const out = await runTurn(open("Something beyond."), data, r.deps);
  check("blob already exists -> held", out.kind === "beyond" && out.held === true);

  const calls: { name: string; body: string; options: Record<string, unknown> }[] = [];
  const spy = (async (name: string, body: string, options: Record<string, unknown>) => {
    calls.push({ name, body, options });
    return {};
  }) as unknown as ConstructorParameters<typeof BlobCollector>[1];
  const record = { statement: "Her words.", fellThrough: "threshold" };
  await new BlobCollector("collector/", spy).append(record);
  check(
    "blob record: two fields, private, named by its own content, never overwritten",
    calls.length === 1 &&
      calls[0].name === `collector/${recordName(record)}.json` &&
      Object.keys(JSON.parse(calls[0].body)).join() === "statement,fellThrough" &&
      calls[0].options.access === "private" &&
      calls[0].options.allowOverwrite === false,
  );
  check("record name depends on both fields", recordName(record) !== recordName({ ...record, fellThrough: "no cog" }));
}
{
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collector-")), "records.jsonl");
  await new FileCollector(file).append({ statement: 'Line one.\n"Quoted."', fellThrough: "no cog" });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const parsed = JSON.parse(lines[0]);
  check(
    "file record: one line, exactly two fields, verbatim",
    lines.length === 1 && Object.keys(parsed).join() === "statement,fellThrough" && parsed.statement === 'Line one.\n"Quoted."',
  );
  fs.rmSync(path.dirname(file), { recursive: true });
}

// --- the door cannot be skipped ---------------------------------------------------------

{
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const disagree: Turn[] = [{ type: "disagree", cog: a }];
  const more: Turn[] = [{ type: "more", text: "ok" }];
  const none = await limitOf(runTurn({ band: "3-5", account: "Something beyond.", turns: disagree }, data, r.deps));
  const forged = await limitOf(runTurn({ band: "3-5", account: "Something beyond.", turns: disagree, passed: "0".repeat(64) }, data, r.deps));
  const noneMore = await limitOf(runTurn({ band: "3-5", account: "Something beyond.", turns: more }, data, r.deps));
  const otherBand = await limitOf(runTurn({ ...then("An account.", disagree), band: "6-8" }, data, r.deps));
  const otherText = await limitOf(runTurn({ ...then("An account.", disagree), account: "Another account." }, data, r.deps));
  check("no token -> tangled", none === "tangled" && noneMore === "tangled", `${none}, ${noneMore}`);
  check("forged token -> tangled", forged === "tangled", forged);
  check("token for another band or text -> tangled", otherBand === "tangled" && otherText === "tangled");

  // A "no" has to answer a reading this server gave, led by that same cog.
  const offered = then("An account.", disagree).passed; // the token that came with a reading led by a
  const otherCog = await limitOf(runTurn({ band: "3-5", account: "An account.", turns: [{ type: "disagree", cog: b, note: "No." }], passed: offered }, data, r.deps));
  const noToAnAsk = await limitOf(runTurn({ band: "3-5", account: "An account.", turns: disagree, passed: then("An account.", more).passed }, data, r.deps));
  const replyToAReading = await limitOf(runTurn({ band: "3-5", account: "An account.", turns: more, passed: offered }, data, r.deps));
  check("a no to a cog that was not offered -> tangled", otherCog === "tangled", otherCog);
  check("a no where an ask was offered -> tangled", noToAnAsk === "tangled", noToAnAsk);
  check("a reply where a reading was offered -> tangled", replyToAReading === "tangled", replyToAReading);

  // Earlier turns are covered too: a changed note, or an earlier "no" moved to another cog.
  const two: Turn[] = [{ type: "disagree", cog: a, note: "First note." }, { type: "disagree", cog: b }];
  const good = then("An account.", two);
  const changedNote = await limitOf(runTurn({ ...good, turns: [{ type: "disagree", cog: a, note: "Another note." }, two[1]] }, data, r.deps));
  const changedCog = await limitOf(runTurn({ ...good, turns: [{ type: "disagree", cog: b, note: "First note." }, two[1]] }, data, r.deps));
  check("an earlier note or cog changed -> tangled", changedNote === "tangled" && changedCog === "tangled", `${changedNote}, ${changedCog}`);
  check("tampered -> nothing read, nothing kept", r.events.length === 0);

  const said = steps("x", [{ type: "more", text: "y" }]);
  check(
    "sign/verify",
    verify(TEST_SECRET, sign(TEST_SECRET, "K-2", said, "ask"), "K-2", said, "ask") &&
      !verify(TEST_SECRET, sign(TEST_SECRET, "K-2", said, "ask"), "K-2", said, `lead:${a}`) &&
      !verify(TEST_SECRET, sign(TEST_SECRET, "K-2", said, "ask"), "K-2", steps("y", [{ type: "more", text: "x" }]), "ask"),
  );
}
{
  // The token each response carries is the one the next turn needs: a whole thread, end to end.
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const first = await runTurn(open("An account."), data, r.deps);
  const turns: Turn[] = [{ type: "disagree", cog: a, note: "A note." }];
  const second = await limitOf(runTurn({ band: "3-5", account: "An account.", turns, passed: "passed" in first ? first.passed : undefined }, data, r.deps));
  check("a reading's token lets her answer that reading", second === "no limit", second);

  const asked = rig({ threshold: { scope: "inside" }, read: { situation: "topic_only", cogs: [], meaning: "" } });
  const ask = await runTurn(open("a topic"), data, asked.deps);
  const reply: Turn[] = [{ type: "more", text: "What happened." }];
  const third = await limitOf(runTurn({ band: "3-5", account: "a topic", turns: reply, passed: "passed" in ask ? ask.passed : undefined }, data, asked.deps));
  check("an ask's token lets her reply to that ask", third === "no limit", third);
}
{
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const many: Turn[] = Array.from({ length: MAX_TURNS + 1 }, () => ({ type: "disagree", cog: a }) as Turn);
  check("too many turns", (await limitOf(runTurn(then("An account.", many), data, r.deps))) === "turns");
  check("too long", (await limitOf(runTurn(open("x".repeat(MAX_CHARS + 1)), data, r.deps))) === "long");
  check("exactly the limit is fine", (await limitOf(runTurn(open("x".repeat(MAX_CHARS)), data, r.deps))) === "no limit");
  check("blank account", (await limitOf(runTurn(open("  \n "), data, r.deps))) === "empty");
  check("blank reply", (await limitOf(runTurn(then("a topic", [{ type: "more", text: " " }]), data, r.deps))) === "empty");
  check("unknown cog", (await limitOf(runTurn(then("An account.", [{ type: "disagree", cog: "9.9" }]), data, r.deps))) === "tangled");
}
{
  // What the browser receives carries nothing the evaluation looks at.
  const r = rig({ threshold: { scope: "inside" }, read: present([a]) });
  const wire = toResponse(await runTurn(open("An account."), data, r.deps));
  check("wire shape", Object.keys(wire).sort().join() === "cite,held,kind,lead,others,passed,question,text");
}

// --- the in-app cap on turns from one address ---------------------------------------------

{
  let clock = 0;
  const over = createLimiter(RATE_WINDOW_MS, RATE_WINDOW_TURNS, () => clock);
  // Forty teachers on one school address, five turns each, inside the window.
  const meeting = Array.from({ length: 40 * 5 }, () => over("school"));
  check("a staff meeting on one address is let through", meeting.every((refused) => !refused));
  check("past the cap the address is stopped", over("school") === true);
  check("another address is not affected", over("elsewhere") === false);
  clock = RATE_WINDOW_MS + 1;
  check("once the window has passed the address is let through again", over("school") === false);
}

// --- the data files take ordinary punctuation ---------------------------------------------

{
  const head = parseHeader(
    [
      "id: 5.K",
      'name: "Culture" and bonds',
      "cite: 5.9 A name: with a colon, a # sign and it's fine",
      "status: DRAFT: Kim to review",
      "",
      "## Acting on",
      "id: not a header line",
    ].join("\n"),
    ["id", "name", "cite", "status"],
  );
  check(
    "cog header: colons, quotation marks and # are kept as written",
    head.id === "5.K" && head.name === '"Culture" and bonds' && head.cite === "5.9 A name: with a colon, a # sign and it's fine" && head.status === "DRAFT: Kim to review",
    JSON.stringify(head),
  );
  const fenced = parseHeader(['---', 'id: "5.1"', "name: Culture", "---", ""].join("\n"), ["id", "name"]);
  check("cog header: the older fenced style still reads", fenced.id === "5.1" && fenced.name === "Culture", JSON.stringify(fenced));

  const [wrapped] = parseSections(
    ["## parents", "status: final", "sentence: That one sits with families, not classroom management —", "this system only works inside classroom management.", "", "What sits there: with a colon."].join("\n"),
    "test",
    { keys: ["status", "sentence", "lookup"], required: ["status", "sentence"], wraps: ["sentence"] },
  );
  check(
    "threshold sentence: wrapped onto a second line, she still sees all of it",
    wrapped.sentence === "That one sits with families, not classroom management — this system only works inside classroom management." &&
      wrapped.body === "What sits there: with a colon." &&
      wrapped.lookup === undefined,
    JSON.stringify(wrapped),
  );
  const [slot] = parseSections(["## a.slot", "status: DRAFT by Luna", "The text: she sees.", "On two lines."].join("\n"), "test", { keys: ["status"] });
  check("copy slot: the line under status is the text, not more status", slot.status === "DRAFT by Luna" && slot.body === "The text: she sees.\nOn two lines.");

  // A placeholder is never counted as hers: a paragraph can be a draft under a final sentence.
  const list = drafts(data);
  const finalSentences = data.beyond.filter((x) => x.status === "final");
  check(
    "drafts: a draft lookup under a final sentence is listed",
    finalSentences.every((x) => x.sitsStatus === "final" || list.includes(`threshold.md "${x.id}" lookup`)),
  );
  check("drafts: the rules sections are listed while they are drafts", (["threshold", "reading", "meaning"] as const).every((x) => data.rulesStatus[x] === "final" || list.includes(`rules.md "${x}"`)));
  const cite = data.cogs.find((c) => c.citeSentence)?.citeSentence ?? "";
  check("cite sentence: read from its own section, whole and on one line", cite !== "" && !cite.includes("\n"), cite);
}

console.log(`turn checks: ${passedCount} passed, ${failed} failed`);
if (failed) process.exit(1);
