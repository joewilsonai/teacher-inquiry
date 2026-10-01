"use client";

import { useMemo, useState } from "react";
import type { Band, BoxSummary } from "@/lib/boxes";
import type { InquiryResult, Turn } from "@/lib/inquire";

const BANDS: { id: Band; label: string; hint: string }[] = [
  { id: "K-2", label: "K–2", hint: "Kindergarten to 2nd" },
  { id: "3-5", label: "3–5", hint: "3rd to 5th" },
  { id: "6-8", label: "6–8", hint: "6th to 8th" },
];

type Entry = { result: InquiryResult; response?: Turn };

export default function Inquiry({ boxes, draft }: { boxes: BoxSummary[]; draft: boolean }) {
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const [band, setBand] = useState<Band | null>(null);
  const [situation, setSituation] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disagreeing, setDisagreeing] = useState(false);
  const [note, setNote] = useState("");

  const started = entries.length > 0 || loading;
  const turnsOf = (list: Entry[]) => list.flatMap((e) => (e.response ? [e.response] : []));

  async function ask(turns: Turn[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inquire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ band, situation, turns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setEntries((prev) => [...prev, { result: data as InquiryResult }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function respond(turn: Turn) {
    const updated = entries.map((e, i) => (i === entries.length - 1 ? { ...e, response: turn } : e));
    setEntries(updated);
    setDisagreeing(false);
    setNote("");
    ask(turnsOf(updated));
  }

  function startOver() {
    setEntries([]);
    setSituation("");
    setError(null);
    setDisagreeing(false);
    setNote("");
  }

  const current = entries.at(-1);
  const waiting = current && !current.response ? current.result : null;
  const label = (id: string) => `${id} · ${byId.get(id)?.name ?? ""}`;

  return (
    <main className="wrap">
      {draft && (
        <p className="draft">
          Prototype. The boxes are placeholder text until Kim&rsquo;s real definitions go in.
        </p>
      )}

      <header className="intro">
        <p className="eyebrow">Classroom environment</p>
        <h1>What&rsquo;s happening in your room?</h1>
        <p className="lede">
          Pick your grade band and describe it the way you&rsquo;d tell a colleague. We&rsquo;ll suggest where to start
          looking, and you tell us if that&rsquo;s right.
        </p>
      </header>

      {!started ? (
        <form
          className="card ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (band && situation.trim().length >= 3) ask([]);
          }}
        >
          <fieldset className="bands">
            <legend>Grade band</legend>
            {BANDS.map((b) => (
              <button
                type="button"
                key={b.id}
                className={band === b.id ? "band on" : "band"}
                aria-pressed={band === b.id}
                onClick={() => setBand(b.id)}
              >
                <span className="band-label">{b.label}</span>
                <span className="band-hint">{b.hint}</span>
              </button>
            ))}
          </fieldset>

          <label className="field">
            <span>What&rsquo;s going on?</span>
            <textarea
              value={situation}
              onChange={(e) => setSituation(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="During independent work my kids keep getting up and talking, and I have to redirect them over and over."
            />
          </label>

          <button className="primary" type="submit" disabled={!band || situation.trim().length < 3}>
            Find a starting point
          </button>
          {error && (
            <p className="error-inline" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <section className="thread" aria-live="polite">
          <div className="card said">
            <p className="eyebrow">
              You said <span className="chip">{band}</span>
            </p>
            <blockquote>{situation}</blockquote>
          </div>

          {entries.map((entry, i) => {
            const r = entry.result;
            const resp = entry.response;
            if (resp && r.kind === "suggest") {
              return (
                <div key={i} className={`past ${resp.type === "agree" ? "yes" : "no"}`}>
                  <span className="mark">{resp.type === "agree" ? "✓" : "✗"}</span>
                  <span>
                    <strong>{label(r.boxId)}</strong>
                    {resp.type === "agree" ? " — you agreed" : " — you disagreed"}
                    {resp.type === "disagree" && resp.note ? `: “${resp.note}”` : ""}
                  </span>
                </div>
              );
            }
            if (resp && r.kind === "choose" && resp.type === "agree") {
              return (
                <div key={i} className="past yes">
                  <span className="mark">✓</span>
                  <span>
                    <strong>{label(resp.boxId)}</strong> — you picked this one
                  </span>
                </div>
              );
            }
            if (resp && r.kind === "none" && resp.type === "more") {
              return (
                <div key={i} className="past more">
                  <span className="mark">+</span>
                  <span>You added: “{resp.note}”</span>
                </div>
              );
            }
            return null;
          })}

          {waiting?.kind === "suggest" && (
            <div className="card suggestion">
              <p className="eyebrow">{waiting.parentId === "root" ? "Starting point" : `Inside ${waiting.parentId}`}</p>
              <h2>{label(waiting.boxId)}</h2>
              <p className="explain">{waiting.explanation}</p>
              <p className="question">Do you mostly agree or disagree with that starting point?</p>
              {!disagreeing ? (
                <div className="choices">
                  <button className="primary" onClick={() => respond({ type: "agree", boxId: waiting.boxId })}>
                    Mostly agree
                  </button>
                  <button className="secondary" onClick={() => setDisagreeing(true)}>
                    Mostly disagree
                  </button>
                </div>
              ) : (
                <form
                  className="followup"
                  onSubmit={(e) => {
                    e.preventDefault();
                    respond({ type: "disagree", boxId: waiting.boxId, note: note.trim() || undefined });
                  }}
                >
                  <label className="field">
                    <span>What feels off? (optional, but it helps)</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} autoFocus />
                  </label>
                  <div className="choices">
                    <button className="primary" type="submit">
                      Try again
                    </button>
                    <button className="link" type="button" onClick={() => setDisagreeing(false)}>
                      Never mind
                    </button>
                  </div>
                </form>
              )}
              <details className="why">
                <summary>Why the AI chose this</summary>
                <p>{waiting.evidence}</p>
              </details>
            </div>
          )}

          {waiting?.kind === "none" && (
            <div className="card suggestion">
              <p className="eyebrow">Not sure yet</p>
              <p className="explain">{waiting.explanation}</p>
              <form
                className="followup"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) respond({ type: "more", note: note.trim() });
                }}
              >
                <label className="field">
                  <span>Tell us a bit more</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} autoFocus />
                </label>
                <button className="primary" type="submit" disabled={!note.trim()}>
                  Try again
                </button>
              </form>
            </div>
          )}

          {waiting?.kind === "choose" && (
            <div className="card suggestion">
              <p className="eyebrow">Your call</p>
              <h2>Which of these sounds closest?</h2>
              <p className="explain">We&rsquo;ve guessed twice and missed. You know your room. Pick the one that fits best.</p>
              <div className="options">
                {waiting.options.map((id) => (
                  <button key={id} className="option" onClick={() => respond({ type: "agree", boxId: id })}>
                    <strong>{label(id)}</strong>
                    <span>{byId.get(id)?.definition}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {waiting?.kind === "done" && (
            <div className="card done">
              <p className="eyebrow">Your starting point</p>
              <ol className="trail">
                {waiting.path.map((id) => (
                  <li key={id}>
                    <strong>{id}</strong> {byId.get(id)?.name}
                  </li>
                ))}
              </ol>
              <p className="explain">That&rsquo;s as deep as the boxes go right now. The next step is Kim&rsquo;s to write.</p>
            </div>
          )}

          {loading && (
            <div className="card thinking" role="status">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="sr">Thinking</span>
            </div>
          )}

          {error && (
            <div className="card error" role="alert">
              <p>{error}</p>
              <button className="secondary" onClick={() => ask(turnsOf(entries))}>
                Try again
              </button>
            </div>
          )}

          <button className="link restart" onClick={startOver} disabled={loading}>
            Start over
          </button>
        </section>
      )}
    </main>
  );
}
