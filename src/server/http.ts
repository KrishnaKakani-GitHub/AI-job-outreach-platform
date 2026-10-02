import { z } from "zod";
import { errorMessage, log } from "./log";

/** Parse a JSON body with a Zod schema; returns a 400 Response on failure. */
export async function parseBody<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: Response.json({ error: "Body must be JSON." }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: Response.json({ error: "Invalid request.", details: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 }),
    };
  }
  return { ok: true, data: parsed.data };
}

export function serverError(event: string, e: unknown): Response {
  log("error", event, { error: errorMessage(e) });
  return Response.json({ error: "Something went wrong on the server. Try again." }, { status: 500 });
}
