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

export interface ChatProfile {
  resume: string;
  background: string;
  resumeVersion?: string;
  resumes?: { version: string; text: string; savedAt: number }[];
}

export function buildChatRequest(input: {
  messages: ChatSourceMessage[];
  text: string;
  profile: ChatProfile;
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
  const current = input.profile.resumeVersion || "v1";
  const others = (input.profile.resumes ?? []).filter((r) => r.version !== current && r.text.trim());
  if (resume) {
    const list = others.length ? ` Other saved versions: ${others.map((r) => r.version).join(", ")}.` : "";
    parts.push(`Resume status: RECEIVED and saved. Current version ${current}.${list}`);
    parts.push(`The user's saved resume (${current}):\n${resume.slice(0, RESUME_MAX)}`);
  } else {
    parts.push("The user has not saved a resume yet.");
  }
  if (background) parts.push(`The user's saved background:\n${background.slice(0, BACKGROUND_MAX)}`);
  const budget = () => CONTEXT_MAX - parts.join("\n\n").length - 40;
  if (input.app?.jobText && budget() > 500) parts.push(`Job post for the current application:\n${input.app.jobText.slice(0, budget())}`);
  // Older tailored versions, newest first, while they fit.
  for (const r of [...others].sort((a, b) => b.savedAt - a.savedAt)) {
    const room = budget() - 40;
    if (room < 400) break;
    parts.push(`Saved resume ${r.version}:\n${r.text.trim().slice(0, room)}`);
  }

  return { messages, context: parts.join("\n\n").slice(0, CONTEXT_MAX) };
}

// ---- Deterministic guard on the reply ----

const RESUME = String.raw`(?:r[eé]sum[eé]s?|cv)`;
/**
 * "I didn't get/see/receive your (updated) resume". Only an article and one
 * adjective may sit between the verb and "resume", so "I don't see SQL on
 * your resume" (about its content) is not matched.
 */
const DENIED = new RegExp(
  String.raw`\b(?:didn'?t|did not|haven'?t|have not|don'?t|do not|can'?t|cannot|couldn'?t|wasn'?t|was not|isn'?t|is not|never|no)\b[^.!?\n]{0,30}\b(?:see|seen|get|got|receive|received|find|found|have|access)\s+(?:(?:a|any|your|the|an)\s+)?(?:(?!(?:on|in|of|from|to|for|with|at)\b)[\w-]+\s+)?${RESUME}\b`,
  "i",
);
/** "your resume came through empty / is missing / wasn't attached". */
const EMPTY = new RegExp(String.raw`\b${RESUME}\b[^.!?\n]{0,40}\b(?:came through empty|was empty|is empty|is missing|was missing|didn'?t come through|did not come through|wasn'?t attached|was not attached|not attached|not received|didn'?t upload|did not upload|failed to upload)\b`, "i");
/** "first message came through empty" in a reply that is about the resume. */
const EMPTY_MESSAGE = /\b(?:message|attachment|file|upload)\b[^.!?\n]{0,30}\b(?:came through empty|was empty|didn'?t come through|did not come through)\b/i;
/** "Could you paste your resume", "please share your resume". */
const ASK_AGAIN = new RegExp(String.raw`\b(?:paste|send|share|upload|attach|provide|re-?send)\b[^.!?\n]{0,25}\b(?:your|the|a)\s+${RESUME}\b`, "i");

export interface GuardResult {
  text: string;
  fixed: boolean;
  removed: string[];
}

/**
 * The validated layer around the chat model: when a resume is saved, remove
 * any sentence that says it wasn't received or asks for it again, and say
 * plainly which version is on file. Sentences about the resume's content
 * ("your resume doesn't mention SQL") are left alone.
 */
export function guardResumeClaims(reply: string, saved: { has: boolean; version: string; count: number }): GuardResult {
  if (!saved.has || !reply.trim()) return { text: reply, fixed: false, removed: [] };
  const removed: string[] = [];
  const isBad = (x: string) => DENIED.test(x) || EMPTY.test(x) || EMPTY_MESSAGE.test(x) || ASK_AGAIN.test(x);
  // Line by line (keeps markdown lists), sentence by sentence within a line.
  const lines = reply.split("\n").map((line) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((x) => {
      if (isBad(x)) {
        removed.push(x.trim());
        return false;
      }
      return true;
    });
    return { line: kept.join(" "), emptied: kept.length === 0 && sentences.some((x) => x.trim()) };
  });
  if (!removed.length) return { text: reply, fixed: false, removed };
  const note = `I have your resume saved (${saved.version}${saved.count > 1 ? `, one of ${saved.count} versions on file` : ""}) and I'm using it.`;
  const body = lines
    .filter((l) => !l.emptied)
    .map((l) => l.line)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: body ? `${note}\n\n${body}` : note, fixed: true, removed };
}
