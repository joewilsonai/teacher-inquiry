import { isDraft, loadData } from "@/lib/data";
import Inquiry from "./Inquiry";

export const dynamic = "force-dynamic";

export default function Page() {
  // Read on every request, so an edit to data/ shows on the next page load.
  const data = loadData();
  return <Inquiry cogs={data.cogs.map(({ id, name }) => ({ id, name }))} copy={data.copy} draft={isDraft(data)} />;
}
