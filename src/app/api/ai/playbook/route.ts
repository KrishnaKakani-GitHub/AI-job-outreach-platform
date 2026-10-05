import { rewordRules, RewordInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, RewordInput);
  if (!body.ok) return body.res;
  try {
    const rules = await rewordRules(body.data);
    log("info", "audit.playbook_reword", {
      who: "anonymous-user",
      what: "playbook_rules",
      why: "new rules learned from the user's outcomes",
      count: rules.length,
      ai: rules.filter((r) => r.source === "ai").length,
    });
    return Response.json({ rules });
  } catch (e) {
    return serverError("playbook.error", e);
  }
}
