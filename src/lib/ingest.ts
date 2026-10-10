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

export interface ResumeEntry {
  version: string;
  text: string;
  savedAt: number;
}

export interface ResumeLibrary {
  resume: string;
  resumeVersion: string;
  resumes: ResumeEntry[];
}

export const MAX_RESUMES = 20;

/** Highest "vN" in use, so a new resume gets the next number. */
function nextFreeLabel(labels: string[], current: string): string {
  const nums = labels.map((l) => l.match(/^[vV](\d{1,3})$/)).filter(Boolean).map((m) => Number(m![1]));
  if (nums.length) return `v${Math.max(...nums) + 1}`;
  let label = nextResumeVersion(current, "x", "y");
  while (labels.includes(label)) label = nextResumeVersion(label, "x", "y");
  return label;
}

/**
 * Save a pasted resume into the library. Users keep several tailored resumes:
 * a new text gets its own version and becomes current; a text that matches a
 * saved version (ignoring whitespace) switches back to that version instead
 * of duplicating it. A legacy single resume is kept as the first version.
 */
export function addResume(lib: ResumeLibrary, text: string, now: number): ResumeLibrary & { added: boolean } {
  const resumes: ResumeEntry[] = [...lib.resumes];
  if (lib.resume.trim() && !resumes.some((r) => norm(r.text) === norm(lib.resume))) {
    // The current resume isn't in the library yet (saved before it existed, or
    // edited in the Profile panel). Keep it, under a label no other version uses.
    const label = lib.resumeVersion || "v1";
    const free = resumes.some((r) => r.version === label) ? nextFreeLabel(resumes.map((r) => r.version), label) : label;
    resumes.push({ version: free, text: lib.resume, savedAt: 0 });
  }
  const match = resumes.find((r) => norm(r.text) === norm(text));
  if (match) return { resume: match.text, resumeVersion: match.version, resumes, added: false };
  const version = resumes.length ? nextFreeLabel(resumes.map((r) => r.version), lib.resumeVersion || "v1") : lib.resumeVersion || "v1";
  resumes.push({ version, text, savedAt: now });
  // Keep the newest; never drop the one being made current.
  const kept = resumes.length > MAX_RESUMES ? resumes.slice(resumes.length - MAX_RESUMES) : resumes;
  return { resume: text, resumeVersion: version, resumes: kept, added: true };
}
