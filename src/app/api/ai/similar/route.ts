import { aiEnabled, AiUnavailableError } from "@/server/ai";
import { similarCompanies, SimilarInput } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

export async function POST(req: Request) {
  const body = await parseBody(req, SimilarInput);
  if (!body.ok) return body.res;
  if (!aiEnabled()) return Response.json({ error: "Similar-company suggestions need an AI key. Add ANTHROPIC_API_KEY to enable them." }, { status: 501 });
  try {
    const companies = await similarCompanies(body.data);
    log("info", "audit.similar_companies", { who: "anonymous-user", what: "similar_companies", why: "final-round rejection", count: companies.length });
    return Response.json({ companies });
  } catch (e) {
    if (e instanceof AiUnavailableError) return Response.json({ error: e.message }, { status: 501 });
    return serverError("similar.error", e);
  }
}
