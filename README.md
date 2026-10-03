# Starting Point (teacher-inquiry)

A teacher picks a grade band (K–2, 3–5, 6–8) and describes, in her own words, what is happening
in her room. The tool finds a shared, provisional place to start inside Kim's model of
classroom management and hands it back to her as a short paraphrase she can agree or disagree with.
It gives no advice. It names a starting place and stops.

**Live:** https://startingpoint.openfeedbackfactory.org (Vercel project `obeyllc/teacher-inquiry`).
The live site runs whatever is on `main`. This rebuild is on the `clock-v1` branch until it is merged,
so the live site still shows the earlier version.

## What happens in a turn

1. **Band.** She picks one. Nothing is preselected and the system never guesses it.
2. **Her account.** One text box. No categories, no menus, no questions first.
3. **The threshold.** Before anything is read, the system decides one thing: is this something she
   can move from inside her own classroom? If it sits somewhere else (a parent, curriculum, grading,
   the building's schedule, a crisis), she sees one sentence saying where it sits and the turn stops.
   No reading is ever built for it.
4. **The reading.** Inside the threshold, one of three things comes back:
   - **Mostly one cog.** A paraphrase naming it, with its citation.
   - **Several.** The paraphrase leads with the strongest and names the others in the same turn. It
     does not ask her for more.
   - **Nothing to land on yet.** She named a topic rather than a situation. The system asks what was
     happening and she writes more.
5. **The paraphrase** always has this shape, and always ends with the same question:

   > This sounds mostly like a **[cog]** issue. In this model that means **[what that means for what
   > she described]**. That reading comes from **[the citation]**. Do you mostly agree or disagree
   > with that starting point?

6. **Her answer.** "Mostly agree" ends the turn, and the whole reading she agreed to stays on the
   page, including any other cogs it named. "Mostly disagree", with or without a note, is new
   evidence. A note goes through the threshold like anything else she writes, so it can be turned
   there too. Otherwise everything she has written is read again and a new reading comes back.

There are four cogs. Three are Missouri's Standard 5 Quality Indicators. Each has a name teachers
recognize and the exact name Missouri gives it, and the paraphrase uses the first to name it and the
second to cite it. The fourth, **5.K Instructional Coordination**, is Kim's authored
construct. Missouri has no Quality Indicator for it, and the paraphrase says so.

| Cog | Named to her as | Cited as |
|---|---|---|
| 5.1 | Management, Motivation & Engagement | 5.1 Classroom Management Techniques |
| 5.2 | Time, Space, Transitions & Activities | 5.2 Management of Time, Space, Transitions, and Activities |
| 5.3 | Culture | 5.3 Classroom, school and community culture |
| 5.K | Instructional Coordination | no Quality Indicator exists; the paraphrase says so |

The citation names come from Missouri's Teacher Standards (August 2025), Standard 5: Positive
Classroom Environment: https://dese.mo.gov/educator-quality/educator-preparation/media/pdf/teacher-standards

## Run it

```bash
npm install
echo "ANTHROPIC_API_KEY=..." > .env.local
npm run dev          # http://localhost:3210
npm run typecheck
npm run check        # data and turn checks; no model calls, costs nothing
npm run drafts       # lists everything still marked DRAFT
npm run eval         # runs data/tests.md through the real model (about 110 calls, under $1)
npm run build        # runs the checks first, then builds
```

`npm run build` runs `npm run check` before it builds, so a data file that does not load stops the
deploy instead of reaching the live site. (The checks need the dev dependencies, which Vercel
installs by default.)

Locally the collector writes to `.collector/records.jsonl`, which git ignores.

## Kim's files

Everything a teacher can read is in `data/`. Nothing she sees is written in the code. Edits show up
on the next page load when running locally, and on the next deploy for the live site.

Every item carries a `status`. There are two: **`final`** means the words are Kim's own, and
**`DRAFT`** (followed by who wrote it) means a placeholder. While anything is DRAFT, the page shows
the prototype banner. `npm run drafts` lists what is left.

The files are plain text. A value is everything after the first colon on its line, exactly as
written, so colons, quotation marks and `#` inside a sentence are fine.

### `data/cogs/`: one file per cog

```markdown
id: 5.2
name: Time, Space, Transitions & Activities
cite: 5.2 Management of Time, Space, Transitions, and Activities
status: DRAFT by Luna. ...

## Acting on
One line: what the teacher is acting on when this is the cog.

## Definition
The plain-language meaning. The middle of the paraphrase is built from this, applied to what she wrote.

## Fallback meaning
One clause that finishes "In this model that means ___". Used when the system's own clause is unusable.

## Examples
- Things teachers say that belong here

## Near-misses
- "Something that sounds like this cog." This is <another cog>: why.
```

`name` is what she sees. `cite` must be Missouri's name exactly (`npm run check` compares it letter
for letter). 5.K has no `cite:` line. It has a `## Cite sentence` section instead, and that sentence
is shown in place of "That reading comes from ...".

### `data/threshold.md`: one section per place beyond

```markdown
## curriculum
status: final
sentence: That one sits in curriculum, not classroom management — this system only works inside classroom management.
lookup: DRAFT by Luna

A paragraph saying what sits in this place. The teacher never sees it; it is how the system tells
the places apart.
```

The `sentence` is exactly what she sees. It can run onto a second line; leave a blank line after it.
`lookup:` is the status of the paragraph underneath, so a sentence can be final while its paragraph
is still a placeholder. To add a place, add a section.

### `data/rules.md`: how the system reads her

Three short lists of rules: how an account is placed at the threshold (`threshold`), how a reading
chooses among the cogs (`reading`), and what the middle clause of the paraphrase looks like
(`meaning`). She never sees these lines as written, but they decide what she is shown: for example
where a mixed account sits, what counts as severe, and that the clause begins "the starting place
is ...". Each section has its own `status`. Every one is a DRAFT by Luna until Kim rewrites it.

### `data/copy.md`: every other word on the page

One section per piece of text: headings, buttons, the frame of the paraphrase, the question asked
when there is nothing to land on, the sentence that says her words are held, and the sentences for
each limit of the system. Words in curly braces, like `{name}`, are filled in by the system.

| Slots | What they are |
|---|---|
| `site.*`, `banner.draft`, `page.*`, `band.legend` | browser tab, banner, heading and intro |
| `account.*`, `said.eyebrow` | the first screen and the card that shows what she wrote |
| `reading.eyebrow`, `paraphrase.*` | the paraphrase: lead, meaning, cite, others, closing question |
| `agree.button`, `disagree.*` | her answer |
| `ask.*` | the card that asks what was happening |
| `held.sentence` | "I'm keeping what you wrote so this gets better at it." |
| `beyond.*` | the card for an account beyond the threshold |
| `settled.*`, `past.*`, `status.thinking`, `restart` | after she agrees, earlier turns, small labels |
| `limits.*` | the system's own limits (too long, too many turns, busy, offline, and so on) |
| `down.sentence` | the one sentence shown if the page itself cannot load |

When the system does not come back with an answer (`limits.unavailable`, `limits.busy`,
`limits.offline`) the page keeps what she wrote and offers to send the same turn again. "Start over"
goes back to the first screen with her account still in the box. `down.sentence` and `limits.retry`
are also built into the error page, so a change to either shows after the next build or restart.

### `data/tests.md`: the test accounts

Accounts that are not in the cog files, each tagged with what should come back. The format is
explained at the top of the file. It includes what she does next (agree, disagree with or without
a note, a reply when asked for more). The current set is a DRAFT; Kim's replaces it.

`npm run eval` reports a score against a 90% bar, the score by kind of expected answer and by band,
and a list of structural problems that must be zero whatever the score: a reading built for an
account beyond the threshold, words read before they went through the threshold, a broken paraphrase
frame, a wrong citation, advice or a motive in a reading, a collector record that is missing, extra
or not verbatim. Last run on the DRAFT set (October 3, 2026): 62 of 63, no structural problems.

## The collector

The collector keeps what the system could not place, so Kim can see where it falls short. It is an
append-only store, and the app only writes to it. A record has exactly two fields: what she wrote, word for word, and where it fell through.
No band, no time, no tags, no scores.

Three things are written:

| When | Second field |
|---|---|
| Her account is turned at the threshold | `threshold` |
| There is a situation and none of the four cogs fits | `no cog` |
| A cog was found and she said "mostly disagree" | `5.2, she said no` (the cog she said no to) |

Nothing is written when she agrees, when a reading is waiting for her answer, or when she named
only a topic. A "mostly disagree" writes one record, the one that names the cog she said no to. If
nothing else fits after her no, that is still the only record: the account did find a cog, so it is
not also filed as `no cog`. If what she wrote with her no is turned at the threshold, both things
happened and both are written (her no first, then `threshold`).

Whenever a record is written she is told, with the `held.sentence` copy, and only if the write
actually succeeded. A failed write never stops her turn. Her words are never written to the server
log.

**Where it lives.** `COLLECTOR` chooses: `file` (a local file, the default when developing), `blob`
(a private Vercel Blob store, the default on the deployed site and on previews, which write under
`preview/` so they can be cleared separately), or `none`. Each record is stored under a name made
from its own two fields, so a retried turn does not create a second copy.

`none` keeps nothing. It is for a preview that has no store yet. The page never says her words are
held, and the server log shows `collector_off record_not_kept` each time a record would have been
written. A preview with no store and no `COLLECTOR=none` answers every turn with the "unavailable"
limit instead.

**Reading it.** The app has no code that reads the collector, and `npm run check` fails if any is
added. That is a rule of the code, not of the store: the Blob credential that lets the app write
could also read. Kim gets the contents from one command, run by hand by whoever holds the credential:

```bash
BLOB_READ_WRITE_TOKEN=... npx tsx tools/collector-export.ts > collector.csv
```

The CSV has the two fields plus the time the store received each record (the store keeps that time
by itself; it is not in the record).

## Before this goes live

Set in Vercel for Production and Preview:

| Variable | What for |
|---|---|
| `ANTHROPIC_API_KEY` | the model |
| `TURN_SECRET` | signs each thread so earlier words cannot skip the threshold (32 random bytes, hex) |
| `BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` with the project's OIDC | the collector's store |
| `SITE_PASSWORD` (optional) | puts the whole site behind one shared password |

A deployment missing any of the first three answers its first request with the "unavailable" limit
and logs `startup_assertion_failed` with the missing names. Do one real write from a preview and
confirm it with `vercel blob list` before a teacher uses it.

**Not done yet, and needed before this branch is merged.** Without `SITE_PASSWORD` the site is open
to anyone with the link, and every turn makes up to two model calls and can write to the collector.
One of these has to be in place first:

- a spend cap on the API key, and a platform rate limit (a Vercel firewall rule) on `POST /api/turn`; or
- `SITE_PASSWORD`.

The app's own cap on turns per network address (`RATE_WINDOW_TURNS` in `lib/limits.ts`, 200 in ten
minutes) is only a backstop. It lives in one server instance's memory and resets with it. It is
sized so that a staff meeting on one school address is not stopped.

## How it's built

- `lib/data.ts`, `lib/sections.ts`, `lib/slots.ts` read `data/`.
- `lib/turn.ts` is the turn. It runs the threshold on whatever she just wrote, then the reading, and
  writes to the collector.
- `lib/model.ts` makes the two model calls (Claude Opus 5.5, structured output). Each answer has to
  be one of the ids in `data/`, so nothing outside the authored set can come back. The model is not
  told the band. The frames of the two prompts are in this file; the line calls inside them come
  from `data/rules.md`.
- `lib/paraphrase.ts` assembles the paraphrase from the frames in `copy.md`.
- `lib/collector.ts` is the collector. `lib/env.ts` is the startup check. `lib/rate.ts` is the
  in-app cap on turns.
- `lib/passed.ts` signs the thread. The server keeps nothing between turns, so the browser sends the
  thread back each time with a signature over the band, everything she did in order, and what the
  server offered last. A reply has to answer an ask this server made, and a "no" has to answer a
  reading this server gave, led by that same cog.
- `app/api/turn/route.ts` is the endpoint. `app/Inquiry.tsx` is the page, `app/Settled.tsx` the
  card after she agrees, `app/error.tsx` and `app/global-error.tsx` what shows if the page cannot load.
- `scripts/check.ts`, `scripts/stubs.ts`, `scripts/eval.ts` are the checks and the evaluation.

## Open questions for Kim

These are built one way for now and are hers to settle:

- The threshold sentences for parents, assessment, data, scheduling, the atypical classroom, and
  anything else beyond; and the paragraph under each that says what sits there, including the two
  under the curriculum and crisis sentences.
- The plain-language definition of each cog, and its fallback clause.
- The sentence shown for 5.K in place of a citation, and whether her name appears in it.
- The sentence that names another cog when several fire, and where it sits. Now: each other cog gets
  that sentence to itself, after the citation.
- The question asked when there is nothing to land on.
- What she sees after "mostly agree". Now: the whole reading she agreed to, and one closing line.
- A "mostly disagree" with no note. Now: the cog she said no to is not named on the next reading; if
  nothing else fits, she is asked what was happening and only her no is kept.
- Whether what she writes with a "mostly disagree" goes through the threshold. Now: it does, like
  anything else she writes, so a note about a crisis or a parent is turned there and no reading is
  built for it.
- A bare word such as "parents". Now: it passes the threshold and she is asked what was happening.
- Whether a topic with no situation is kept in the collector. Now: it is not.

The line calls in `data/rules.md` are all hers to settle too. The ones that move the most accounts:

- A mixed account (part hers, part someone else's). Now: it is inside, and only her part is read.
- Severity. Now: a violent or dangerous episode, or "the usual procedures don't touch this", is
  beyond even though she was in the room; an episode goes to the crisis sentence and a standing
  condition of the whole room to the atypical one.
- How she feels about her own classroom is inside; her health, pay, contract and colleagues are
  beyond. The culture of the building is beyond; the culture of her room is hers.
- A situation that is about herself, with nothing in the room named that she is acting on. Now:
  none of the four cogs is offered, and it is kept as `no cog`.
- Her own word for an age or grade. Now: the middle clause says "students" or "they" instead.
- The shape of the middle clause. Now: every one begins "the starting place is ...".
