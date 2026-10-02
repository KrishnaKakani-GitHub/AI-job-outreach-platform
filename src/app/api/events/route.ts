import { z } from "zod";
import { ExperimentEvent } from "@/lib/schemas";
import { recordEvent } from "@/server/store";
import { parseBody, serverError } from "@/server/http";

const Batch = z.object({ events: z.array(ExperimentEvent).min(1).max(20) });

export async function POST(req: Request) {
  const body = await parseBody(req, Batch);
  if (!body.ok) return body.res;
  try {
    for (const e of body.data.events) await recordEvent(e);
    return new Response(null, { status: 204 });
  } catch (e) {
    return serverError("events.error", e);
  }
}
