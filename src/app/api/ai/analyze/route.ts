import { analyzeFit, AnalyzeInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, AnalyzeInput);
  if (!body.ok) return body.res;
  try {
    const report = await analyzeFit(body.data);
    log("info", "audit.analyze_fit", { who: "anonymous-user", what: "fit_report", why: "user pasted a job post", source: report.source, score: report.score });
    return Response.json(report);
  } catch (e) {
    return serverError("analyze.error", e);
  }
}
