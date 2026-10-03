"use client";

import "./globals.css";

// The same card as app/error.tsx, for a failure in the frame around the page. It replaces
// the whole document, so it brings its own <html> and <body>.
export default function SiteDown({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body>
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
      </body>
    </html>
  );
}
