import { rulesFromNotes, NotesInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, NotesInput);
  if (!body.ok) return body.res;
  try {
    const result = await rulesFromNotes(body.data);
    log("info", "audit.notes_rules", {
      who: "anonymous-user",
      what: "rules_from_outcome_notes",
      why: "user logged outcome notes",
      notes: body.data.notes.length,
      proposed: result.rules.length,
      dropped: result.dropped,
    });
    return Response.json(result);
  } catch (e) {
    return serverError("notes_rules.error", e);
  }
}
