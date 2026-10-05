import { EXPERIMENT } from "@/lib/ab";
import { persistence, startedAt, summarize } from "@/server/store";
import { serverError } from "@/server/http";

export async function GET() {
  try {
    const [arms, started] = await Promise.all([summarize(EXPERIMENT), startedAt(EXPERIMENT)]);
    return Response.json({ experiment: EXPERIMENT, persistence: persistence(), startedAt: started, arms });
  } catch (e) {
    return serverError("results.error", e);
  }
}
