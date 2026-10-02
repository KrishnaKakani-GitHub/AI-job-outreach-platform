/**
 * Deterministic checks that decide whether a draft is shown as-is, flagged,
 * or regenerated. The model proposes; these functions decide.
 */
import type { Draft } from "./schemas";
import { containsLoose, keywords } from "./text";
import { renderDraft } from "./draft";

export type IssueKind = "ungrounded" | "unknown_name" | "length" | "style" | "relevance";
export interface Issue {
  kind: IssueKind;
  severity: "error" | "warn";
  message: string;
}

export interface Sources {
  recipient: string;
  me: string;
  job: string;
}

const ALLOWED_CAPITALIZED = new Set(
  ("Hi Hello Dear Best Thanks Thank Regards Sincerely I I'm I've I'd I'll Would Could If Happy Looking Great " +
    "LinkedIn Subject Fellow The This That My We You Your Our As And But So Also Just Recently Quick Question " +
    "Re Monday Tuesday Wednesday Thursday Friday").split(" "),
);

/** Every claim must quote its source verbatim and appear in the segment text. */
export function checkGrounding(draft: Draft, src: Sources): Issue[] {
  const issues: Issue[] = [];
  for (const seg of draft.segments) {
    for (const c of seg.claims) {
      const source = src[c.source];
      if (!containsLoose(source, c.quote)) {
        issues.push({ kind: "ungrounded", severity: "error", message: `"${c.text}" cites text that is not in the ${label(c.source)}.` });
      } else if (!containsLoose(seg.text, c.text)) {
        issues.push({ kind: "ungrounded", severity: "warn", message: `A cited phrase ("${c.text}") does not appear in the message.` });
      }
    }
  }
  return issues;
}

/**
 * Hallucination guard: capitalized names in the draft (people, schools,
 * companies) must exist in at least one source. Catches invented specifics.
 */
export function checkUnknownNames(draft: Draft, src: Sources): Issue[] {
  const all = `${src.recipient}\n${src.me}\n${src.job}`;
  const text = `${draft.subject ?? ""} ${draft.greeting} ${draft.segments.map((s) => s.text).join(" ")}`;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  // Case-insensitive containment means ordinary sentence-initial words ("In",
  // "Would") pass naturally; only specifics absent from every source are flagged.
  const re = /\b([A-Z][a-zA-Z&'-]{2,}(?:\s+[A-Z][a-zA-Z&'-]+)*)/g;
  for (const m of text.matchAll(re)) {
    const phrase = m[1];
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    const words = phrase.split(/\s+/).filter((w) => !ALLOWED_CAPITALIZED.has(w));
    if (words.length === 0) continue;
    const missing = words.filter((w) => !containsWord(all, w));
    if (missing.length === 0) continue;
    const before = text.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?:,\n]$/.test(before);
    // A lone capitalized word at the start of a sentence is usually an ordinary word.
    if (sentenceStart && words.length === 1) continue;
    issues.push({ kind: "unknown_name", severity: "error", message: `"${phrase}" is not in your profile, the job post, or their profile.` });
  }
  return issues;
}

export function checkLength(draft: Draft, limit: number | null): Issue[] {
  if (!limit) return [];
  const n = renderDraft(draft).length;
  return n > limit ? [{ kind: "length", severity: "error", message: `${n} characters is over the ${limit}-character limit.` }] : [];
}

const FILLER = [
  /\bI hope this (message|email|note) finds you well\b/i,
  /\bpassionate\b/i,
  /\bsynerg(y|ies)\b/i,
  /\bpick your brain\b/i,
  /\bcircle back\b/i,
  /\btouch base\b/i,
];

export function checkStyle(draft: Draft): Issue[] {
  const text = renderDraft(draft, { includeSubject: true });
  const issues: Issue[] = [];
  if (/—/.test(text)) issues.push({ kind: "style", severity: "warn", message: "Uses an em dash. Your style is commas or plain hyphens." });
  if ((text.match(/!/g) ?? []).length > 1) issues.push({ kind: "style", severity: "warn", message: "More than one exclamation mark reads as informal." });
  for (const re of FILLER) {
    const m = text.match(re);
    if (m) issues.push({ kind: "style", severity: "warn", message: `"${m[0]}" is filler. Cut it or say something specific.` });
  }
  return issues;
}

/**
 * Relevance lint: a company fact (a claim sourced from the job post) earns its
 * place only if it shares vocabulary with the sender's own background.
 */
export function checkRelevance(draft: Draft, src: Sources): Issue[] {
  const mine = new Set(keywords(src.me));
  const issues: Issue[] = [];
  for (const seg of draft.segments) {
    for (const c of seg.claims.filter((x) => x.source === "job")) {
      const kw = keywords(c.text);
      if (kw.length && !kw.some((k) => mine.has(k))) {
        issues.push({ kind: "relevance", severity: "warn", message: `"${c.text}" is a company detail that does not connect to your experience.` });
      }
    }
  }
  return issues;
}

export function validateDraft(draft: Draft, src: Sources, limit: number | null): { ok: boolean; issues: Issue[] } {
  const issues = [...checkGrounding(draft, src), ...checkUnknownNames(draft, src), ...checkLength(draft, limit), ...checkStyle(draft), ...checkRelevance(draft, src)];
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

function containsWord(haystack: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`, "i").test(haystack);
}

function label(s: keyof Sources): string {
  return s === "me" ? "your profile" : s === "job" ? "job post" : "recipient's profile";
}
