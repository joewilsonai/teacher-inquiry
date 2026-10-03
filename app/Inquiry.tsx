"use client";

import { useState } from "react";
import { BAND_LABELS, BANDS, type Band } from "@/lib/bands";
import { type Limit, LIMITS, MAX_CHARS, MAX_TURNS, RETRY_LIMITS } from "@/lib/limits";
import { type Copy, fill, type Slot } from "@/lib/slots";
import type { Turn, TurnResponse } from "@/lib/turn";
import { Settled } from "./Settled";

// Every word on this page comes from data/copy.md (the "copy" prop) or from the server's
// authored response. Nothing a teacher reads is written in this file.

type Answer = { type: "agree" } | { type: "disagree"; note?: string } | { type: "more"; text: string };
type Entry = { res: TurnResponse; answer?: Answer };
type Props = { cogs: { id: string; name: string }[]; copy: Copy; draft: boolean };

export default function Inquiry({ cogs, copy, draft }: Props) {
  const t = (slot: Slot) => copy[slot];
  const nameOf = (id: string) => cogs.find((c) => c.id === id)?.name ?? "";

  const [band, setBand] = useState<Band | null>(null);
  const [account, setAccount] = useState("");
  const [started, setStarted] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState<{ name: Limit; held: boolean } | null>(null);
  const [disagreeing, setDisagreeing] = useState(false);
  const [typing, setTyping] = useState("");

  // The server keeps nothing between turns, so the whole thread goes back each time,
  // along with its signature that the earlier words already passed the threshold.
  async function send(list: Entry[]) {
    setLoading(true);
    setLimit(null);
    const turns: Turn[] = list.flatMap((e): Turn[] => {
      if (e.res.kind === "ask" && e.answer?.type === "more") return [{ type: "more", text: e.answer.text }];
      if (e.res.kind === "reading" && e.answer?.type === "disagree") {
        return [{ type: "disagree", cog: e.res.lead, note: e.answer.note }];
      }
      return [];
    });
    const passed = list.map((e) => ("passed" in e.res ? e.res.passed : undefined)).findLast(Boolean);
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ band, account, turns, passed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const name: Limit = LIMITS.includes(body?.limit) ? body.limit : "busy";
        setLimit({ name, held: body?.held === true });
        return;
      }
      // A network that answers for the server (a school filter, a sign-in page) returns 200
      // with something that is not a turn. Treat it as not having reached the server.
      if (!body || typeof (body as { kind?: unknown }).kind !== "string") {
        setLimit({ name: "offline", held: false });
        return;
      }
      setEntries([...list, { res: body as TurnResponse }]);
    } catch {
      setLimit({ name: "offline", held: false });
    } finally {
      setLoading(false);
    }
  }

  function answer(a: Answer) {
    const updated = entries.map((e, i) => (i === entries.length - 1 ? { ...e, answer: a } : e));
    setEntries(updated);
    setDisagreeing(false);
    setTyping("");
    // "Mostly agree" ends the turn here. Nothing is sent and nothing is kept.
    if (a.type !== "agree") send(updated);
  }

  // Back to the first screen. What she first wrote stays in the box, so starting over never
  // costs her the words; she changes or clears them herself. "Write about something else",
  // and starting over after she has agreed on a starting point, open an empty box: that
  // account is finished, and leaving it there would join it to whatever she writes next.
  function startOver(keepWords = true) {
    setStarted(false);
    setEntries([]);
    if (!keepWords) setAccount("");
    setLimit(null);
    setDisagreeing(false);
    setTyping("");
  }

  const current = entries.at(-1);
  const waiting = current && !current.answer ? current.res : null;
  const settled = current?.res.kind === "reading" && current.answer?.type === "agree" ? current.res : null;
  const held = <p className="held">{t("held.sentence")}</p>;
  const limitSentence = limit
    ? fill(t(`limits.${limit.name}` as const), { max: MAX_CHARS.toLocaleString("en-US"), turns: String(MAX_TURNS) })
    : "";

  return (
    <main className="wrap">
      {draft && <p className="draft">{t("banner.draft")}</p>}

      <header className="intro">
        <p className="eyebrow">{t("page.eyebrow")}</p>
        <h1>{t("page.title")}</h1>
        <p className="lede">{t("page.lede")}</p>
      </header>

      {!started ? (
        <form
          className="card ask"
          onSubmit={(e) => {
            e.preventDefault();
            if (!band || account.trim().length === 0) return;
            setStarted(true);
            send([]);
          }}
        >
          <fieldset className="bands">
            <legend>{t("band.legend")}</legend>
            {BANDS.map((b) => (
              <button
                type="button"
                key={b}
                className={band === b ? "band on" : "band"}
                aria-pressed={band === b}
                onClick={() => setBand(b)}
              >
                <span className="band-label">{BAND_LABELS[b]}</span>
              </button>
            ))}
          </fieldset>

          <label className="field">
            <span>{t("account.label")}</span>
            <textarea
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              rows={5}
              maxLength={MAX_CHARS}
              placeholder={t("account.placeholder")}
            />
          </label>

          <button className="primary" type="submit" disabled={!band || account.trim().length === 0}>
            {t("account.submit")}
          </button>
        </form>
      ) : (
        <section className="thread" aria-live="polite">
          <div className="card said">
            <p className="eyebrow">
              {t("said.eyebrow")} {band && <span className="chip">{BAND_LABELS[band]}</span>}
            </p>
            <blockquote>{account}</blockquote>
          </div>

          {entries.map((entry, i) => {
            const { res, answer: a } = entry;
            // A reading she agreed with is shown whole on the card below, not as a row here.
            if (res.kind === "reading" && a?.type === "disagree") {
              return (
                <div key={i} className="past no">
                  <span className="mark">✗</span>
                  <span>
                    <strong>{nameOf(res.lead)}</strong> — {t("past.disagreed")}
                    {a.note ? `: “${a.note}”` : ""}
                  </span>
                </div>
              );
            }
            if (res.kind === "ask" && a?.type === "more") {
              return (
                <div key={i} className="past more">
                  <span className="mark">+</span>
                  <span>
                    {t("past.added")} “{a.text}”
                  </span>
                </div>
              );
            }
            return null;
          })}

          {waiting?.kind === "beyond" && (
            <div className="card reading">
              <p className="eyebrow">{t("beyond.eyebrow")}</p>
              <p className="explain">{waiting.sentence}</p>
              {waiting.held && held}
              <div className="choices">
                <button className="secondary" onClick={() => startOver(false)}>
                  {t("beyond.again")}
                </button>
              </div>
            </div>
          )}

          {waiting?.kind === "ask" && (
            <div className="card reading">
              <p className="eyebrow">{t("ask.eyebrow")}</p>
              <p className="explain">{waiting.sentence}</p>
              {waiting.held && held}
              <form
                className="followup"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (typing.trim()) answer({ type: "more", text: typing });
                }}
              >
                <label className="field">
                  <span>{t("ask.label")}</span>
                  <textarea
                    value={typing}
                    onChange={(e) => setTyping(e.target.value)}
                    rows={4}
                    maxLength={MAX_CHARS}
                    autoFocus
                  />
                </label>
                <button className="primary" type="submit" disabled={!typing.trim()}>
                  {t("ask.submit")}
                </button>
              </form>
            </div>
          )}

          {waiting?.kind === "reading" && (
            <div className="card reading">
              <p className="eyebrow">{t("reading.eyebrow")}</p>
              <p className="explain">{waiting.text}</p>
              <p className="question">{waiting.question}</p>
              {!disagreeing ? (
                <div className="choices">
                  <button className="primary" onClick={() => answer({ type: "agree" })}>
                    {t("agree.button")}
                  </button>
                  <button className="secondary" onClick={() => setDisagreeing(true)}>
                    {t("disagree.button")}
                  </button>
                </div>
              ) : (
                <form
                  className="followup"
                  onSubmit={(e) => {
                    e.preventDefault();
                    answer({ type: "disagree", note: typing.trim() ? typing : undefined });
                  }}
                >
                  <label className="field">
                    <span>{t("disagree.label")}</span>
                    <textarea
                      value={typing}
                      onChange={(e) => setTyping(e.target.value)}
                      rows={3}
                      maxLength={MAX_CHARS}
                      autoFocus
                    />
                  </label>
                  <div className="choices">
                    <button className="primary" type="submit">
                      {t("disagree.submit")}
                    </button>
                    <button
                      className="link"
                      type="button"
                      onClick={() => {
                        setDisagreeing(false);
                        setTyping("");
                      }}
                    >
                      {t("disagree.cancel")}
                    </button>
                  </div>
                </form>
              )}
              {waiting.held && held}
            </div>
          )}

          {settled && <Settled text={settled.text} copy={copy} />}

          {loading && (
            <div className="card thinking" role="status">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="sr">{t("status.thinking")}</span>
            </div>
          )}

          {limit && (
            <div className="card reading" role="status">
              <p className="explain">{limitSentence}</p>
              {limit.held && held}
              {RETRY_LIMITS.includes(limit.name) && (
                <div className="choices">
                  <button className="secondary" onClick={() => send(entries)}>
                    {t("limits.retry")}
                  </button>
                </div>
              )}
            </div>
          )}

          <button className="link restart" onClick={() => startOver(!settled)} disabled={loading}>
            {t("restart")}
          </button>
        </section>
      )}
    </main>
  );
}
