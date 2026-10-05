/**
 * Tailoring a resume to one job, deterministically checked.
 *
 * The model (or the rules fallback) proposes a plan: a summary, rewrites of
 * existing lines, bullet order within sections, and cover-letter talking
 * points. validatePlan() keeps only what passes the checks below, and
 * applyPlan() renders the result and lists every change with the rule that
 * caused it.
 *
 * Checks (a rewrite that fails any of them is dropped, and the reason shown):
 *   - it rewrites a line that exists, and isn't a heading;
 *   - every number in it already appears in the original line ([add metric] is allowed);
 *   - it adds no term the job post uses that the resume never mentions (no keyword stuffing);
 *   - every capitalized name in it appears in the resume;
 *   - no em dashes.
 */
import { z } from "zod";
import type { FitReport } from "./schemas";
import { parseCv, renderCv, type CvLine, type ParsedCv } from "./resume";
import { surface } from "./learn";
import { GENERIC_TERMS, keywords } from "./text";

export const TailorPlan = z.object({
  summary: z.object({ text: z.string().max(600), ruleIds: z.array(z.string().max(220)).max(10).default([]) }).nullable().default(null),
  edits: z
    .array(z.object({ lineId: z.string().max(20), text: z.string().max(500), ruleIds: z.array(z.string().max(220)).max(10).default([]), why: z.string().max(240).default("") }))
    .max(30)
    .default([]),
  order: z.array(z.object({ section: z.string().max(60), lineIds: z.array(z.string().max(20)).max(60) })).max(12).default([]),
  talkingPoints: z.array(z.object({ text: z.string().max(300), quote: z.string().max(400) })).max(4).default([]),
  applied: z.array(z.string().max(220)).max(40).default([]),
});
export type TailorPlan = z.infer<typeof TailorPlan>;

export interface Rejected {
  what: string;
  reason: string;
}

export interface Change {
  kind: "summary" | "rewrite" | "moved";
  before: string | null;
  after: string;
  ruleIds: string[];
  why: string;
}

export interface Tailored {
  text: string;
  changes: Change[];
  rejected: Rejected[];
  talkingPoints: { text: string; quote: string }[];
  /** Rule ids the kept changes applied. */
  applied: string[];
  /** Requirement terms the job post uses that your resume never mentions. Shown, never inserted. */
  missing: string[];
}

const NUM = /\d+(?:[.,]\d+)?%?/g;
const CAP = /\b([A-Z][a-zA-Z0-9&+.#-]{1,}(?:\s+[A-Z][a-zA-Z0-9&+.#-]+)*)/g;
const ALLOWED_CAPS = new Set("I A An The For With And Built Led Designed Developed Created Reduced Increased Improved Shipped Owned Partnered Ran Wrote Analyzed Automated Launched Delivered Defined Engineered Implemented Managed Drove Cut Grew Scaled Tested Measured Modeled Validated Summary SQL".split(" "));

function numbersIn(s: string): string[] {
  return (s.replace(/\[add metric\]/gi, "").match(NUM) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Requirement terms from the job post that appear nowhere in the resume. */
export function jobOnlyTerms(resume: string, jobText: string, fit: FitReport | null): Set<string> {
  const mine = new Set(keywords(resume));
  const job = keywords(fit ? fit.ratings.map((r) => r.requirement).join(" ") + "\n" + jobText : jobText);
  return new Set(job.filter((t) => !mine.has(t)));
}

export function checkRewrite(original: string, next: string, resume: string, jobOnly: Set<string>): string | null {
  if (/—/.test(next)) return "uses an em dash";
  const allowed = new Set(numbersIn(original));
  const bad = numbersIn(next).filter((n) => !allowed.has(n));
  if (bad.length) return `adds a number that isn't in the original line (${bad.join(", ")})`;
  const before = new Set(keywords(original));
  const stuffed = keywords(next).filter((k) => !before.has(k) && jobOnly.has(k));
  if (stuffed.length) return `adds a job-post term your resume doesn't support (${[...new Set(stuffed)].join(", ")})`;
  for (const m of next.matchAll(CAP)) {
    const words = m[1].split(/\s+/).filter((w) => !ALLOWED_CAPS.has(w));
    const unknown = words.filter((w) => !new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(resume));
    if (unknown.length) return `names something not in your resume (${unknown.join(" ")})`;
  }
  return null;
}

export function checkSummary(next: string, resume: string, jobOnly: Set<string>, roleWords: string): string | null {
  if (/—/.test(next)) return "uses an em dash";
  const allowed = new Set(numbersIn(resume));
  const bad = numbersIn(next).filter((n) => !allowed.has(n));
  if (bad.length) return `adds a number that isn't in your resume (${bad.join(", ")})`;
  const role = new Set(keywords(roleWords));
  const stuffed = keywords(next).filter((k) => jobOnly.has(k) && !role.has(k));
  if (stuffed.length) return `claims a job-post term your resume doesn't support (${[...new Set(stuffed)].join(", ")})`;
  for (const m of next.matchAll(CAP)) {
    const words = m[1].split(/\s+/).filter((w) => !ALLOWED_CAPS.has(w));
    const unknown = words.filter((w) => !new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(`${resume}\n${roleWords}`));
    if (unknown.length) return `names something not in your resume (${unknown.join(" ")})`;
  }
  return null;
}

/** Relevance of a resume line to the job: overlap with requirement terms, plus strong-evidence quotes. */
export function relevance(line: CvLine, reqTerms: Set<string>, strongQuotes: string[], boosts: string[] = []): number {
  const kw = keywords(line.text);
  let score = kw.filter((k) => reqTerms.has(k)).length;
  if (strongQuotes.some((q) => q && line.text.includes(q.slice(0, 40)))) score += 3;
  if (boosts.some((b) => b && line.text.toLowerCase().includes(b.toLowerCase().slice(0, 40)))) score += 4;
  return score;
}

/** Rules-only plan: reorder bullets by relevance and take talking points from strong fit evidence. */
export function rulesPlan(resume: string, fit: FitReport | null, jobText: string, boosts: string[] = []): TailorPlan {
  const cv = parseCv(resume);
  const reqTerms = new Set(keywords(fit ? fit.ratings.map((r) => r.requirement).join(" ") : jobText));
  const strong = fit?.ratings.filter((r) => r.evidence === "strong" && r.resumeQuote).map((r) => r.resumeQuote!) ?? [];
  const order: TailorPlan["order"] = [];
  for (const section of [...new Set(cv.bullets.map((b) => b.section))]) {
    const bs = cv.bullets.filter((b) => b.section === section);
    const sorted = [...bs].sort((a, b) => relevance(b, reqTerms, strong, boosts) - relevance(a, reqTerms, strong, boosts));
    if (sorted.some((b, i) => b.id !== bs[i].id)) order.push({ section, lineIds: sorted.map((b) => b.id) });
  }
  const tp = (fit?.ratings ?? [])
    .filter((r) => r.evidence === "strong" && r.resumeQuote)
    .slice(0, 3)
    .map((r) => ({ text: `Connect "${r.requirement}" to this work.`, quote: r.resumeQuote! }));
  return { summary: null, edits: [], order, talkingPoints: tp, applied: order.length ? ["resume-tailor/relevant-first"] : [] };
}

export interface ValidateOptions {
  resume: string;
  jobText: string;
  fit: FitReport | null;
  role: string;
  /** Rule ids the plan may cite. Anything else is dropped from the plan's citations. */
  allowedRules: Set<string>;
}

/** Keep only the parts of a plan that pass the checks; record why the rest were dropped. */
export function validatePlan(plan: TailorPlan, o: ValidateOptions): { plan: TailorPlan; rejected: Rejected[] } {
  const cv = parseCv(o.resume);
  const byId = new Map(cv.lines.map((l) => [l.id, l]));
  const jobOnly = jobOnlyTerms(o.resume, o.jobText, o.fit);
  const rejected: Rejected[] = [];
  const cite = (ids: string[]) => ids.filter((id) => o.allowedRules.has(id));

  const edits: TailorPlan["edits"] = [];
  const seen = new Set<string>();
  for (const e of plan.edits) {
    const line = byId.get(e.lineId);
    if (!line || line.heading || seen.has(e.lineId)) {
      rejected.push({ what: e.text, reason: "rewrites a line that isn't in your resume" });
      continue;
    }
    const text = e.text.replace(/^[-•*]\s+/, "").trim();
    if (text === line.text) continue;
    const why = checkRewrite(line.text, text, o.resume, jobOnly);
    if (why) {
      rejected.push({ what: text, reason: why });
      continue;
    }
    seen.add(e.lineId);
    edits.push({ ...e, text, ruleIds: cite(e.ruleIds) });
  }

  let summary = plan.summary;
  if (summary) {
    const why = checkSummary(summary.text, o.resume, jobOnly, o.role);
    if (why) {
      rejected.push({ what: summary.text, reason: why });
      summary = null;
    } else summary = { ...summary, ruleIds: cite(summary.ruleIds) };
  }

  const order: TailorPlan["order"] = [];
  for (const g of plan.order) {
    const ids = cv.bullets.filter((b) => b.section === g.section).map((b) => b.id);
    const same = ids.length === g.lineIds.length && new Set(g.lineIds).size === ids.length && g.lineIds.every((id) => ids.includes(id));
    if (same) order.push(g);
    else rejected.push({ what: `Reorder of "${g.section || "top"}"`, reason: "didn't keep exactly the same lines" });
  }

  const talkingPoints = plan.talkingPoints.filter((t) => {
    const ok = t.quote.length > 8 && o.resume.toLowerCase().replace(/\s+/g, " ").includes(t.quote.toLowerCase().replace(/\s+/g, " ").trim());
    if (!ok) rejected.push({ what: t.text, reason: "quotes a line that isn't in your resume" });
    return ok && !/—/.test(t.text);
  });

  return { plan: { summary, edits, order, talkingPoints, applied: cite(plan.applied) }, rejected };
}

/** Render a validated plan and list every change. */
export function applyPlan(resume: string, plan: TailorPlan, fit: FitReport | null, jobText: string, rejected: Rejected[] = []): Tailored {
  const cv: ParsedCv = parseCv(resume);
  const edits = new Map(plan.edits.map((e) => [e.lineId, e]));
  const changes: Change[] = [];
  let lines: CvLine[] = cv.lines.map((l) => {
    const e = edits.get(l.id);
    if (!e) return l;
    changes.push({ kind: "rewrite", before: l.text, after: e.text, ruleIds: e.ruleIds, why: e.why });
    return { ...l, text: e.text };
  });

  for (const g of plan.order) {
    const slots = lines.map((l, i) => (l.bullet && l.section === g.section ? i : -1)).filter((i) => i >= 0);
    const byId = new Map(lines.map((l) => [l.id, l]));
    const moved = g.lineIds.map((id) => byId.get(id)!);
    const next = [...lines];
    slots.forEach((slot, k) => (next[slot] = moved[k]));
    const first = moved[0];
    if (first && lines[slots[0]]?.id !== first.id) changes.push({ kind: "moved", before: null, after: first.text, ruleIds: ["resume-tailor/relevant-first"], why: `Moved to the top of ${g.section || "its section"}.` });
    lines = next;
  }

  if (plan.summary) {
    const existing = lines.filter((l) => l.section === "summary" && !l.heading);
    const before = existing.map((l) => l.text).join(" ") || null;
    if (existing.length) {
      const keep = new Set(existing.slice(1).map((l) => l.id));
      lines = lines.filter((l) => !keep.has(l.id)).map((l) => (l.id === existing[0].id ? { ...l, text: plan.summary!.text, bullet: false } : l));
    } else {
      const firstHeading = lines.findIndex((l) => l.heading);
      const at = firstHeading < 0 ? Math.min(1, lines.length) : firstHeading;
      lines.splice(at, 0, { id: "summary-h", text: "SUMMARY", raw: "SUMMARY", bullet: false, heading: true, section: "summary" }, { id: "summary", text: plan.summary.text, raw: plan.summary.text, bullet: false, heading: false, section: "summary" });
    }
    changes.unshift({ kind: "summary", before, after: plan.summary.text, ruleIds: plan.summary.ruleIds, why: "Summary matched to this job." });
  }

  const applied = [...new Set([...plan.applied, ...changes.flatMap((c) => c.ruleIds)])];
  const names = surface([fit ? fit.ratings.map((r) => r.requirement).join(" ") : "", jobText]);
  const own = new Set(keywords(`${fit?.meta.company ?? ""} ${fit?.meta.role ?? ""} interest`));
  const missing = [...jobOnlyTerms(resume, jobText, fit)].filter((t) => t.length >= 3 && !/\d/.test(t) && !GENERIC_TERMS.has(t) && !own.has(t)).slice(0, 8).map((t) => names.get(t) ?? t);
  return { text: renderCv(lines), changes, rejected, talkingPoints: plan.talkingPoints, applied, missing };
}
