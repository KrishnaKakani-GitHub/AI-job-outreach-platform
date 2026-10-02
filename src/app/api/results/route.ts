import { EXPERIMENT } from "@/lib/ab";
import { persistence, summarize } from "@/server/store";
import { serverError } from "@/server/http";

export async function GET() {
  try {
    return Response.json({ experiment: EXPERIMENT, persistence: persistence(), arms: await summarize(EXPERIMENT) });
  } catch (e) {
    return serverError("results.error", e);
  }
}
