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
import { drafts, loadData } from "../lib/data";
import { MAX_CHARS, MAX_TURNS, RATE_WINDOW_MS, RATE_WINDOW_TURNS, RETRY_LIMITS } from "../lib/limits";
import { ModelBusy, ModelUnavailable, type ReadOutput, thresholdUser } from "../lib/model";
import { compose } from "../lib/paraphrase";
import { type Offered, sign, verify } from "../lib/passed";
import { createLimiter } from "../lib/rate";
import { parseHeader, parseSections } from "../lib/sections";
import { fill } from "../lib/slots";
import { runTurn, steps, toResponse, type Turn, TurnLimit, type TurnRequest } from "../lib/turn";
import { count, type Event, logged, MemoryCollector, NO_REFUSAL, stubModel, TEST_SECRET } from "./harness";

const data = loadData();
const copy = data.copy;
const ids = data.cogs.map((c) => c.id);
const [a, b] = ids; // any two cogs
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

const present = (cogs: string[], meaning = "the starting place is what you described"): ReadOutput => ({
  situation: "present",
  cogs,
  meaning,
});

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
  // A situation that lands on none of the four: ask, tell her it is held, keep it.
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
  const [lead, ...rest] = data.cogs;
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
  const r = rig({ threshold: { scope: "inside" }, read: present(ids.slice(0, 3), "the starting place is the thing you described") });
  const out = await runTurn(open("An account."), data, r.deps);
  const page = out.kind === "reading" ? renderToStaticMarkup(createElement(Settled, { text: out.text, copy })).replaceAll("&amp;", "&").replaceAll("&#x27;", "'") : "";
  const named = data.cogs.slice(0, 3);
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
