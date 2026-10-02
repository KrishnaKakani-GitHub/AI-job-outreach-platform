import { z } from "zod";
import { Application } from "@/lib/schemas";
import { buildStrategyFacts } from "@/lib/strategy";
import { strategyNarrative } from "@/server/services";
import { parseBody, serverError } from "@/server/http";
import { log } from "@/server/log";

const Input = z.object({ applications: z.array(Application).max(500), resume: z.string().max(40000).default("") });

export async function POST(req: Request) {
  const body = await parseBody(req, Input);
  if (!body.ok) return body.res;
  try {
    // Facts are recomputed server-side from the records; the client's numbers are never trusted.
    const facts = buildStrategyFacts(body.data.applications, body.data.resume);
    const narrative = await strategyNarrative(facts);
    log("info", "audit.strategy", { who: "anonymous-user", what: "strategy_report", why: "user asked for next steps", apps: body.data.applications.length, source: narrative.source });
    return Response.json({ facts, narrative });
  } catch (e) {
    return serverError("strategy.error", e);
  }
}
