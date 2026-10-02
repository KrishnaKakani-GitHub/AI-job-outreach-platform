import { z } from "zod";
import { aiEnabled, asData, DATA_RULE, streamText } from "@/server/ai";
import { parseBody } from "@/server/http";
import { errorMessage, log } from "@/server/log";

const Input = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(12),
  context: z.string().max(4000).default(""),
});

const SYSTEM = [
  "You are Warm Intro, a concise job-search assistant for early-career candidates.",
  "You help with outreach messages, fit checks against job posts, and next steps. Be direct and specific; 2 to 6 sentences unless asked for more.",
  "Never invent facts about the user, companies, or people. If you need a document, ask the user to paste it (resume, job post, or the person's LinkedIn profile).",
  "Rejection reasons are hypotheses, never certainties.",
  DATA_RULE,
].join("\n");

export async function POST(req: Request) {
  const body = await parseBody(req, Input);
  if (!body.ok) return body.res;
  const encoder = new TextEncoder();
  if (!aiEnabled()) {
    const text =
      "I can help with three things here: paste a job post to get a fit check, paste someone's LinkedIn profile to get an outreach draft, or ask \"What should I do next?\" once you have logged a few applications. Free-form answers need an AI key, which isn't configured on this deployment.";
    return new Response(encoder.encode(text), { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const system = body.data.context ? `${SYSTEM}\n\n${asData("workspace_context", body.data.context)}` : SYSTEM;
        for await (const chunk of streamText(system, body.data.messages)) controller.enqueue(encoder.encode(chunk));
        log("info", "audit.chat", { who: "anonymous-user", what: "chat_reply", why: "user question", ms: Date.now() - started });
      } catch (e) {
        log("warn", "chat.stream_failed", { error: errorMessage(e) });
        controller.enqueue(encoder.encode("\n\nThe reply was cut off by a connection problem. Send your message again."));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
