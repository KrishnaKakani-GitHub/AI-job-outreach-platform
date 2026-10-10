/**
 * Pure helpers for taking in documents: resume versioning (so A/B analysis
 * can compare resume versions) and recovering a resume the classifier missed.
 */
import { classifyDocument, resumeHits } from "./classify";

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The version label for a newly saved resume. Same text (ignoring whitespace)
 * or no previous resume keeps the label; a different resume bumps it:
 * "v1" → "v2", "fall-2026" → "fall-2026-2", "fall-2026-2" → "fall-2026-3".
 */
export function nextResumeVersion(current: string, oldResume: string, newResume: string): string {
  const label = current.trim() || "v1";
  if (!oldResume.trim() || norm(oldResume) === norm(newResume)) return label;
  // Bump "v3" or a short "-2" suffix; never a year or other long number ("fall-2026").
  const v = label.match(/^([vV])(\d{1,3})$/);
  if (v) return `${v[1]}${Number(v[2]) + 1}`;
  const suffix = label.match(/^(.*-)(\d{1,2})$/);
  if (suffix && suffix[1].length > 1) return `${suffix[1]}${Number(suffix[2]) + 1}`.slice(0, 40);
  return `${label}-2`.slice(0, 40);
}

export interface PasteLike {
  role: "user" | "assistant";
  kind: string;
  text?: string;
  payload?: unknown;
}

/**
 * The most recent pasted text in a chat that is most likely a resume, for when
 * none was saved (it was labelled something else, or left unlabelled).
 * Requires the resume label to win, or at least three resume signals.
 */
export function findResumeInHistory(messages: PasteLike[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || m.kind !== "paste" || !m.text || m.text.length < 200) continue;
    const docKind = (m.payload as { docKind?: string } | undefined)?.docKind;
    if (docKind === "job_description" || docKind === "recipient_profile") continue;
    const c = classifyDocument(m.text);
    if (c.kind === "resume" || resumeHits(m.text) >= 3) return m.text;
  }
  return null;
}
