# Starting Point (teacher-inquiry)

A teacher picks a grade band (K–2, 3–5, 6–8) and describes, in her own words, what is happening
in her room. The tool finds a shared, provisional place to start inside Kim's model of
classroom management and hands it back to her as a short paraphrase she can agree or disagree with.
It gives no advice. It names a starting place and stops.

**Live:** https://startingpoint.openfeedbackfactory.org (Vercel project `obeyllc/teacher-inquiry`).
The live site runs whatever is on `main`. As of October 3, 2026 that includes the change to how a
reading reaches Instructional Coordination: it is worked out after the sort instead of being one of
the choices in it (see "Instructional Coordination" below).

## What happens in a turn

1. **Band.** She picks one. Nothing is preselected and the system never guesses it.
2. **Her account.** One text box. No categories, no menus, no questions first.
3. **The threshold.** Before anything is read, the system decides one thing: is this something she
   can move from inside her own classroom? If it sits somewhere else (a parent, curriculum, grading,
   the building's schedule, a crisis), she sees one sentence saying where it sits and the turn stops.
   No reading is ever built for it.
4. **The reading.** Inside the threshold, what she described is sorted to Missouri's three cogs, and
   one of three things comes back:
   - **Mostly one cog.** A paraphrase naming it, with its citation.
   - **Several.** The paraphrase leads with the strongest and names the others in the same turn. It
     does not ask her for more.
   - **Nothing to land on yet.** She named a topic rather than a situation. The system asks what was
     happening and she writes more.

   After the sort, its result is checked. Do her own words name teaching of her own at that
   moment? And for each cog her account was sorted to: do her words put it on her at the same
   moment as that teaching? When her teaching is named and enough was on her alongside it (one
   cog, as built), the paraphrase leads with Instructional Coordination and names the sorted cogs
   after it.
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
second to cite it. An account is sorted to these three and to nothing else.

The fourth, **5.K Instructional Coordination**, is Kim's own. Missouri has no Quality Indicator for
it. The paraphrase says so, and says that it is a proposed part of this model. An account is never
sorted to it.

| Cog | Named to her as | Cited as |
|---|---|---|
| 5.1 | Management, Motivation & Engagement | 5.1 Classroom Management Techniques |
| 5.2 | Time, Space, Transitions & Activities | 5.2 Management of Time, Space, Transitions, and Activities |
| 5.3 | Culture | 5.3 Classroom, school and community culture |
| 5.K | Instructional Coordination | no Quality Indicator exists; the paraphrase says so, and says it is proposed |

The citation names come from Missouri's Teacher Standards (August 2025), Standard 5: Positive
Classroom Environment: https://dese.mo.gov/educator-quality/educator-preparation/media/pdf/teacher-standards

### Instructional Coordination

It is reached in three steps, and the last one is code.

1. **The sort.** The reading step sorts her account to Missouri's three cogs. It is not shown
   Instructional Coordination as a choice and is never told its name.
2. **Two more answers, about what it just sorted.** In the same call, the reading step answers:
   - Do her own words name teaching of her own at that moment? Yes or no. It decides by the rules
     in `data/cogs/5.K.md` under "Her teaching is named when". Tying a shoe, taking attendance or
     calming one upset child is not teaching. A kind of lesson named only as the time something
     happens ("during guided reading") does not name her teaching by itself.
   - For each cog it listed: do her own words put this on her at the same moment as that
     teaching? It decides by the rules under "Counts alongside her teaching when".

   It is not told what either answer is used for.
3. **The check.** `lib/turn.ts` takes the cogs that were sorted to and are still offered on this
   turn, and counts how many of them were marked in step 2. If the answer about her teaching was
   no, nothing counts as marked. It then applies one authored line in `data/cogs/5.K.md`:
   `others needed: one`. When what that line asks for is there, Instructional Coordination leads.

What she is shown then:

> This sounds mostly like an Instructional Coordination issue. In this model that means **[what
> that means for what she described]**. Missouri's Standard 5 has no Quality Indicator for this.
> Instructional Coordination is a proposed part of this model. There's also something here about
> Management, Motivation & Engagement. Do you mostly agree or disagree with that starting point?

Every cog her account was sorted to is named after it, in the sort's order, whether or not it was
marked. No Missouri citation appears on that reading, she is not asked for more, and nothing is
kept.

**The one line.** `others needed:` takes `one` or `two`. Each word builds one way of reading the
rule for when Instructional Coordination applies.

- `one` (as built): her teaching and one other thing on her at the same moment are enough. One
  sorted cog, marked, with her teaching named. A reading group at the kidney table while the
  students at their seats wander comes back Instructional Coordination, with Management,
  Motivation & Engagement named after it.
- `two`: her account has to be sorted to at least two cogs, with her teaching on her at the same
  moment as at least one of them. The same kidney-table account comes back as plain Management,
  Motivation & Engagement. An account with slow switching between centers, two boys shoving in
  line, and a reading group waiting on her while she sorts that out comes back Instructional
  Coordination under either word.

With either word it never leads when the reading step answered that no teaching of hers is named.

A stricter third reading is not built: two cogs that are each on her at the same moment as her
teaching. If that is the one Kim means, it is one more word in the table in `lib/data.ts`.

`one` is the builder's default, not a decision. It is the first Instructional Coordination question
under "Open questions for Kim" below.
`npm run check` prints the word in use and passes with either. `npm run eval -- --others two` runs
the test accounts written for `two` without changing any file.

**Mostly disagree.** With no words, her no to Instructional Coordination stands until she writes
something new: the cogs her account was sorted to are offered instead, and it is not named. With
words, everything is read again, and it comes back only if her words say again that the two were on
her together.

If she says no to a sorted cog and adds that she was teaching someone else at that moment, the
reading step decides from her words whether that cog still fits. In every run so far it kept the
cog and marked it. With `one`, the next reading then leads with Instructional Coordination and
names that cog after it. With `two`, one cog is not enough, and that cog alone would be the reading
she just said no to. It does not come straight back: she is asked what was happening, and her no is
kept.

`data/rules.md` has no rule of its own for a no that only adds when or where something happens.
The reading step decides from her words, as it does on the live site. In the test runs that kind
of no moved the reading to another cog (it is one of the open questions below).

**What the code holds, and what it does not.** The code guarantees that Instructional Coordination
never comes back:

- when the reading step answered that her words name no teaching of her own;
- when nothing was sorted, or less was sorted and marked than the line asks for;
- when the only mark is on a cog that was not listed or is no longer offered;
- when the word on the line is one the app does not know;
- after a no to it with no later words.

The code does not hold whether those answers are right. It cannot read her words, and there is no
list of keywords. Two lines are held only by the authored rules in `data/cogs/5.K.md`, through the
reading step's answers:

- whether what she names is teaching of her own (a conference about a student's writing is; tying
  a shoe is not; "during guided reading" by itself is not);
- whether something else was on her at the same moment as that teaching (her teaching with nothing
  else on her is not Instructional Coordination).

A wrong answer on either one shows as a wrong reading. `npm run eval` prints both answers for every
row, so a miss can be traced to one of them.

## Run it

```bash
npm install
echo "ANTHROPIC_API_KEY=..." > .env.local
npm run dev          # http://localhost:3210
npm run typecheck
npm run check        # data and turn checks; no model calls, costs nothing
npm run drafts       # lists everything still marked DRAFT
npm run eval         # runs data/tests.md through the real model (about 180 calls, under $1)
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
for letter).

`5.K.md` is laid out differently, because an account is never sorted to it:

```markdown
id: 5.K
name: Instructional Coordination
status: DRAFT by Luna. ...
others needed: one

## Cite sentence
The sentence shown in place of "That reading comes from ...".

## Acting on, ## Definition, ## Fallback meaning
As in the other cog files.

## Her teaching is named when
- The rules for deciding whether her own words name teaching of her own at that moment.

## Counts alongside her teaching when
- The rules for deciding, one sorted cog at a time, whether her words put it on her at the same
  moment as that teaching.

## Examples
- Things teachers say where it counts

## Near-misses
- "Something that sounds like it." Why it does not count.
```

- It has no `cite:` line. A cog file with neither a `cite:` line nor an `others needed:` line does
  not load, so deleting the line cannot quietly turn it into one more choice in the sort.
- `others needed:` is `one` or `two`. Any other word stops the load and names the file. So does a
  missing "Her teaching is named when" or "Counts alongside her teaching when" section.
- While the file is a DRAFT, `npm run check` fails unless the cite sentence says the cog is
  proposed and says "Quality Indicator". It fails at any status if the sentence calls the cog
  invented, made up or unofficial, or presents it as Missouri's.
- The Examples and Near-misses in this file are about when a cog counts as alongside her teaching.
  They never say which cog an account belongs to and never use this cog's name, because the sorting
  step is never told it. `npm run check` fails if the name appears there, in another cog file, or
  in the `reading` or `meaning` rules in `data/rules.md`.

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

Accounts that are not in the cog files, each tagged with what should come back. (`npm run check`
fails if a test account is also an example in a cog file.) The format is explained at the top of
the file. It includes what she does next (agree, disagree with or without a note, a reply when
asked for more), words that must or must not appear in what she is shown (`[+words]`, `[!word]`),
and `# line probe: <label>` on accounts where the expected answer is a guess about where one of
Kim's lines falls. The current set is a DRAFT; Kim's replaces it.

The section "With her teaching" holds the accounts on either side of the Instructional Coordination
line. Its expected answers are written for `others needed: one`. It includes accounts where two
things are on her and neither is teaching (tying a shoe while the line falls apart), and accounts
where a kind of lesson is named only as the time something happens.

The section "A no that only says when or where" holds two accounts with no teaching in them,
where she says no and adds only when or where it happens.

The section "If the line says two" holds a few of the same accounts with what should come back
under `others needed: two`. A plain run skips it.

```bash
npm run eval -- --section "With her teaching"   # only that section
npm run eval -- --times 3                       # each account three times; says which rows changed
npm run eval -- --only "kidney"                 # only accounts containing that text
npm run eval -- --others two                    # only "If the line says two", as if the line said two
```

`npm run eval` reports a score against a 90% bar, the score by kind of expected answer and by band,
and a list of structural problems that must be zero whatever the score: a reading built for an
account beyond the threshold, words read before they went through the threshold, a broken paraphrase
frame, a wrong citation, advice or a motive in a reading, a collector record that is missing, extra
or not verbatim; Instructional Coordination named as one of the others, leading when the reading
step said no teaching of hers is named, leading without what the line asks for, or shown with a
Missouri citation. Every row also prints what the account was sorted to, whether the reading step
said her teaching is named, and which cogs were marked as alongside it.

Last run on the DRAFT set (October 3, 2026, with `others needed: one`): the whole set seven times.
Six runs matched 100 of 101 rows and one matched 98. No run had a structural problem. One run is
about 180 model calls.

The row that missed every time:

- "He does it on purpose to get attention and wreck my lesson." is asked what was happening where a
  reading was expected (a motive with no conduct; unchanged from the earlier build).

Two rows did not come back the same every time:

- "I can't run guided reading and watch the rest of the room." was asked what was happening in six
  runs, which is what the test file expects. In one run it came back Instructional Coordination,
  with Management, Motivation & Engagement named after it. The line under it (what she adds when
  asked) was then never reached. Those are the two extra misses in that run. A later, larger
  sample of 18 runs of this one account: asked 11 times, Instructional Coordination 7 times.
- "While I'm helping one kid tie his shoes, the line falls apart." was sorted to Management,
  Motivation & Engagement in six runs and to Time, Space, Transitions & Activities in one.
  Instructional Coordination did not lead it in any run, and that is what the row checks.

What the seven runs showed about the lines this change moves:

- Two things on her and neither is teaching (five accounts): never Instructional Coordination.
- A kind of lesson named only as the time it happens (three accounts): plain Management, Motivation
  & Engagement every time.
- A no that only adds when or where (two accounts): the reading moved to Time, Space, Transitions &
  Activities every time, as it does on the live site.
- She says two things were on her and does not say what the second one was (two accounts). The
  guided-reading account above was asked in six runs of seven here, and in 11 of 18 in a larger
  sample. "While I'm teaching fractions at the
  board I can't also keep the back table going." came back Instructional Coordination in all seven,
  as it does on the live site, and the test file now expects that. Nothing but the reading step's
  judgment holds this line, and it is not steady: on the first draft of this change,
  each of the two accounts also flipped once in nine runs.

`npm run eval -- --others two` was run four times and matched every row each time (6 rows a run),
with no structural problems: the kidney-table account came back plain Management, Motivation &
Engagement, the account with a reading group waiting on her came back Instructional Coordination,
and a no that adds "I'm at the kidney table with my group" was asked what was happening.

## The collector

The collector keeps what the system could not place, so Kim can see where it falls short. It is an
append-only store, and the app only writes to it. A record has exactly two fields: what she wrote, word for word, and where it fell through.
No band, no time, no tags, no scores.

Three things are written:

| When | Second field |
|---|---|
| Her account is turned at the threshold | `threshold` |
| There is a situation and it is sorted to no cog | `no cog` |
| A cog was found and she said "mostly disagree" | `5.2, she said no` (the cog she said no to) |

An account that says two things were on her at once, without saying what the second one was, has
nothing to sort: she is asked what was happening and the account is kept as `no cog`. On the live
site some of these come back as Instructional Coordination. How little she has to say about the
second thing before it is sorted is not settled, and no code holds it: the reading step decides. Of
the two test accounts of this kind, one is asked and the other is not (see the result under
`data/tests.md` above).

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

**Open as deployed.** The live site runs without `SITE_PASSWORD`, by the owner's decision, so it is
open to anyone with the link, and every turn makes up to two model calls and can write to the
collector. Neither of these is in place yet:

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
  be one of the ids in `data/`, so nothing outside the authored set can come back. The reading call
  is a sort to Missouri's three cogs, then a yes or no (do her words name teaching of her own?),
  then one answer for each cog it listed (was it on her at the same moment as that teaching?).
  What follows from those answers is decided in `lib/turn.ts`, not by the model. The model is not told the band. The frames of the two prompts are in this file;
  the line calls inside them come from `data/rules.md` and `data/cogs/5.K.md`.
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
- Instructional Coordination. Six things, built one way for now:
  1. **One other thing, or two?** The rule for when it applies can be read two ways: her teaching
     and one other thing on her at the same moment, or two of Missouri's three cogs in her account
     with her teaching also on her. She is at the kidney table with a group and the others wander.
     Now (`others needed: one`): Instructional Coordination. Under `two` it is plain Management,
     Motivation & Engagement, and it takes a second cog in her account to bring it up. Under `one`,
     nearly any second thing on her during her teaching brings it up. Under `two`, if she says no
     to a cog and adds that she was with a group, she is asked what was happening. (A stricter
     third reading, two cogs that are each on her at the same moment as her teaching, is not
     built.)
  2. **Is a lesson going on enough, or does she have to say she is holding both?** "During guided
     reading the kids at their seats won't stop talking." Now: a kind of lesson named only as the
     time it happens is not enough. That is plain Management, Motivation & Engagement, as on the
     live site. It becomes Instructional Coordination once she says where she is ("I'm at the back
     table with my group") or that both were on her. The same line from the other side: "While
     I'm teaching the mini-lesson, the same two girls pass notes." Now: the trouble is inside the
     lesson she is teaching, so that is Management, Motivation & Engagement too.
  3. **What counts as her teaching?** Now: a lesson she is giving, a group she is working with, a
     conference with one student about their work. Tying a shoe, zipping coats, calming one upset
     child and taking attendance are not, so "While I'm helping one kid tie his shoes, the line
     falls apart." is never Instructional Coordination. Stopping to help one student with her math
     is teaching.
  4. **When it applies, what does she see?** Now: it leads even if something else is the bigger
     part of her account, and the cog that brought it up is named with "There's also something
     here about ...", without Missouri's name for it. Or: it leads only when the strongest thing
     is the one tied to her teaching. Or: the Missouri cog leads, with its citation. Inside this:
     after she says no to a cog and adds that she was with a group, the next reading names that
     same cog as the "also". Keep it or drop it?
  5. **The sentence that says it is proposed.** Now: "Missouri's Standard 5 has no Quality
     Indicator for this. Instructional Coordination is a proposed part of this model." What should
     it say, and does her name go in?
  6. **"I can't run guided reading and watch the rest of the room."** Now: she is asked what was
     happening, and the account is kept as `no cog`. "While I'm teaching fractions at the board I
     can't also keep the back table going." is not asked: it comes back Instructional Coordination.
     Is the second thing arriving enough, without her saying what it was? No code holds this line.
     The reading step decides it, and it has flipped from one run to the next (see the last run
     under `data/tests.md`).
- The sentence that names another cog when several fire, and where it sits. Now: each other cog gets
  that sentence to itself, after the citation.
- The question asked when there is nothing to land on.
- What she sees after "mostly agree". Now: the whole reading she agreed to, and one closing line.
- A "mostly disagree" with no note. Now: the cog she said no to is not named on the next reading; if
  nothing else fits, she is asked what was happening and only her no is kept. For Instructional
  Coordination the no stays in force until she writes something new; for the other cogs it lasts one
  reading. Should they match?
- A "mostly disagree" with words that only say when or where it happens ("It's mostly right after
  recess."). Now: there is no rule of its own for it. In the test runs the reading moved from
  Management, Motivation & Engagement to Time, Space, Transitions & Activities, as it does on the
  live site. Should it move, stay, or should she be asked?
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
  no cog is offered, and it is kept as `no cog`.
- Her own word for an age or grade. Now: the middle clause says "students" or "they" instead.
- The shape of the middle clause. Now: every one begins "the starting place is ...".
