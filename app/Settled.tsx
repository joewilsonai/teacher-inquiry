import type { Copy } from "@/lib/slots";

// What stays on the page after "mostly agree": the whole reading she agreed to, word for
// word (the cog it leads with, what that means for what she described, where the reading
// comes from, and any other cog that was named), then one closing line.
export function Settled({ text, copy }: { text: string; copy: Copy }) {
  return (
    <div className="card reading">
      <p className="eyebrow">
        {copy["settled.eyebrow"]} <span className="chip">{copy["past.agreed"]}</span>
      </p>
      <p className="explain">{text}</p>
      <p className="explain">{copy["settled.line"]}</p>
    </div>
  );
}
