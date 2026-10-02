import { draftMessage, DraftInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, DraftInput);
  if (!body.ok) return body.res;
  try {
    const result = await draftMessage(body.data);
    log("info", "audit.draft_message", {
      who: "anonymous-user",
      what: "outreach_draft",
      why: body.data.instruction ? "user revision" : "user pasted a recipient profile",
      stage: body.data.stage,
      channel: body.data.channel,
      source: result.source,
      issues: result.issues.map((i) => i.kind),
    });
    return Response.json(result);
  } catch (e) {
    return serverError("draft.error", e);
  }
}
