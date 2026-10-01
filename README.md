# Starting Point (teacher-inquiry)

A teacher picks a grade band (K–2, 3–5, 6–8) and types what's happening in their classroom.
The AI may look only inside Kim's boxes. It names the one the situation sounds MOST like,
explains it in plain language, and asks whether the teacher mostly agrees or disagrees.

- **Disagree:** what the teacher says becomes new data, and it runs again without that box.
- **Agree:** it goes one level deeper and runs the same step on that box's children.
- It's one loop at every depth. When a box has no children, the teacher has their starting point.

**The current box text is placeholder** written by Luna to prove the machine works. Kim
replaces it. The banner on the page disappears once no file is marked `DRAFT`.

**Live:** https://startingpoint.openfeedbackfactory.org (Vercel project `obeyllc/teacher-inquiry`,
DNS CNAME on Hostinger). Password-gated by `SITE_PASSWORD` (any username).

## Run it

```bash
npm install
echo "ANTHROPIC_API_KEY=..." > .env.local
npm run dev          # http://localhost:3210
npm run eval         # scores the AI against data/tests.md (spends API money, ~$0.50)
```

## Kim's data: the format

One markdown file per box in `data/boxes/`, every box the same shape at every level.
Edits show up on the next request with no restart.

```markdown
---
id: "5.1"
name: Management, Motivation & Engagement
parent: root          # "root" for the top level, otherwise the parent box's id ("5.1")
order: 1
status: final         # anything containing "DRAFT" shows the prototype banner
---

## Definition
The plain-language meaning. The AI builds its explanation to the teacher from this.

## Indicators
- What it looks and sounds like in a room

## Grade bands
### K-2
How it shows up differently in K-2
### 3-5
...
### 6-8
...

## Examples
- Things a real teacher might type that belong here (10+)

## Near-misses
- "Something that sounds like this box" This is 5.2, because ...
```

Near-misses matter most. They're how the AI tells neighboring boxes apart.

The `data/tests.md` file holds situations that are **not** in the box files, each tagged with
the box it should land in. `npm run eval` runs every one through the AI and reports how many it
got right, with the AI's reasoning on every miss.

## Decisions that are Kim's (current defaults in `lib/inquire.ts` → `RULES`)

| Question | Default for now |
|---|---|
| Nothing fits (e.g. a parent email) | AI says so and asks the teacher for more detail |
| Genuinely split between two boxes | Always picks one ("MOST like") |
| Teacher disagrees twice at one level | Stops guessing and shows every box at that level so the teacher picks |

## How it's built

- `lib/boxes.ts` parses the markdown boxes.
- `lib/inquire.ts` makes the AI call: Claude Opus 5.5 with structured output. The answer has to
  be one of the offered box IDs (or `none`), so the AI can't invent a box.
- `app/api/inquire/route.ts` is the endpoint, and `app/Inquiry.tsx` is the page.
- "Why the AI chose this" on each suggestion shows which of the teacher's words matched which
  indicator. It's there so Kim can see the reasoning.
