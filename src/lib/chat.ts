/**
 * Builds the request for the free-form chat. Pure, so it can be tested
 * without the browser database.
 *
 * Why this exists: pasted documents are stored as `kind: "paste"` messages and
 * the saved resume lives on the profile. Before this, the chat only forwarded
 * `kind: "text"` messages and never the profile, so it could not see a resume
 * the user had already pasted and told them it "came through empty".
 */
import type { DocKind } from "./schemas";

export const TURN_MAX = 4000;
export const RESUME_MAX = 10000;
export const BACKGROUND_MAX = 2000;
export const CONTEXT_MAX = 16000;
export const HISTORY_TURNS = 10;

export interface ChatSourceMessage {
  role: "user" | "assistant";
  kind: string;
  text?: string;
  payload?: unknown;
}

export interface ChatApp {
  role: string;
  company: string | null;
  fit: { score: number; gaps: string[] } | null;
  jobText?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const PASTE_LABEL: Record<DocKind, string> = {
  resume: "resume (saved to profile)",
  background: "background (saved to profile)",
  job_description: "job description",
  recipient_profile: "LinkedIn profile",
  message: "email",
  other: "text",
};

/** Kinds whose full text the chat needs to answer about them (emails, unlabelled text). */
const INLINE_KINDS: ReadonlySet<DocKind> = new Set<DocKind>(["message", "other"]);

function docKindOf(m: ChatSourceMessage): DocKind {
  const k = (m.payload as { docKind?: DocKind } | undefined)?.docKind;
  return k ?? "other";
}

/** One message as the model should see it, or null to skip it. */
function toTurn(m: ChatSourceMessage): ChatTurn | null {
  if (!m.text) return null;
  if (m.kind === "text") return { role: m.role, content: m.text.slice(0, TURN_MAX) };
  if (m.kind === "paste" && m.role === "user") {
    const kind = docKindOf(m);
    if (INLINE_KINDS.has(kind)) {
      const tag = kind === "message" ? "pasted_email" : "pasted_text";
      const budget = TURN_MAX - tag.length * 2 - 10;
      return { role: "user", content: `<${tag}>\n${m.text.slice(0, budget)}\n</${tag}>` };
    }
    return { role: "user", content: `[Pasted ${PASTE_LABEL[kind]}, ${m.text.length.toLocaleString("en-US")} chars]` };
  }
  return null;
}

/** Merge consecutive same-role turns and drop leading assistant turns. */
function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content}\n\n${t.content}`.slice(0, TURN_MAX);
    else out.push({ ...t });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export function buildChatRequest(input: {
  messages: ChatSourceMessage[];
  text: string;
  profile: { resume: string; background: string };
  app: ChatApp | null;
}): { messages: ChatTurn[]; context: string } {
  const turns = input.messages.map(toTurn).filter((t): t is ChatTurn => t !== null);
  let messages = normalizeTurns(turns).slice(-HISTORY_TURNS);
  // Slicing can leave an assistant turn first; the model needs a user turn first.
  messages = normalizeTurns(messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: input.text.slice(0, TURN_MAX) });
  }

  const parts: string[] = [];
  if (input.app) {
    parts.push(
      `Current application: ${input.app.role}${input.app.company ? ` at ${input.app.company}` : ""}. ` +
        `Fit score ${input.app.fit?.score ?? "n/a"}. Gaps: ${input.app.fit?.gaps.join(", ") || "none"}.`,
    );
  }
  const resume = input.profile.resume.trim();
  const background = input.profile.background.trim();
  parts.push(resume ? `The user's saved resume:\n${resume.slice(0, RESUME_MAX)}` : "The user has not saved a resume yet.");
  if (background) parts.push(`The user's saved background:\n${background.slice(0, BACKGROUND_MAX)}`);
  const jobBudget = CONTEXT_MAX - parts.join("\n\n").length - 40;
  if (input.app?.jobText && jobBudget > 500) parts.push(`Job post for the current application:\n${input.app.jobText.slice(0, jobBudget)}`);

  return { messages, context: parts.join("\n\n").slice(0, CONTEXT_MAX) };
}
