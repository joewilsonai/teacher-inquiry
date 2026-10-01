import { isDraft, loadBoxes, summarize } from "@/lib/boxes";
import Inquiry from "./Inquiry";

export const dynamic = "force-dynamic";

export default function Page() {
  const boxes = loadBoxes();
  return <Inquiry boxes={summarize(boxes)} draft={isDraft(boxes)} />;
}
