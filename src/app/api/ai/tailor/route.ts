import { tailorResume, TailorInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, TailorInput);
  if (!body.ok) return body.res;
  try {
    const result = await tailorResume(body.data);
    log("info", "audit.tailor_resume", {
      who: "anonymous-user",
      what: "tailored_resume",
      why: body.data.baselineOnly ? "baseline comparison requested" : "user asked to tailor for a job",
      source: result.source,
      changes: result.changes.length,
      rejected: result.rejected.length,
      learnedRules: result.context?.learned.length ?? 0,
    });
    return Response.json(result);
  } catch (e) {
    return serverError("tailor.error", e);
  }
}
