import { interviewPrep, InterviewInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, InterviewInput);
  if (!body.ok) return body.res;
  try {
    const result = await interviewPrep(body.data);
    log("info", "audit.interview_prep", {
      who: "anonymous-user",
      what: "interview_prep",
      why: "application reached the interview stage",
      source: result.source,
      questions: result.prep.questions.length,
      fixed: result.fixed,
    });
    return Response.json(result);
  } catch (e) {
    return serverError("interview.error", e);
  }
}
