"use client";

// Shown in place of the page when it cannot be built: for instance when a file in data/
// does not load. The sentence and the button label are Kim's copy ("down.sentence" and
// "limits.retry" in data/copy.md), baked in by next.config.ts when the site is built.
export default function PageDown({ retry }: { retry: () => void }) {
  return (
    <main className="wrap">
      <div className="card reading" role="status">
        <p className="explain">{process.env.DOWN_SENTENCE}</p>
        <div className="choices">
          <button className="secondary" onClick={() => retry()}>
            {process.env.DOWN_RETRY}
          </button>
        </div>
      </div>
    </main>
  );
}
