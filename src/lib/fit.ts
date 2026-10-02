/**
 * Fit scoring. The AI (or the rules fallback) proposes a per-requirement
 * evidence rating; the score itself is always computed here so it is
 * consistent, explainable, and never invented by a model.
 */
import type { Application, Evidence, FitReport, GapTag, JobMeta, RequirementRating } from "./schemas";
import { extractRequirements } from "./classify";
import { containsLoose, hasNumber, isBullet, keywords, lines, overlapRatio, stripBullet } from "./text";

const EVIDENCE_VALUE: Record<Evidence, number> = { strong: 1, partial: 0.5, missing: 0 };

export function computeScore(ratings: Pick<RequirementRating, "evidence" | "weight">[]): number {
  const total = ratings.reduce((s, r) => s + r.weight, 0);
  if (total === 0) return 0;
  const got = ratings.reduce((s, r) => s + r.weight * EVIDENCE_VALUE[r.evidence], 0);
  return Math.round((got / total) * 100);
}

const TOOLING = /\b(react|next\.?js|typescript|javascript|python|sql|aws|gcp|azure|docker|kubernetes|tableau|looker|dbt|spark|snowflake|figma|excel|jira|java|go|rust|node)\b/i;
const OWNERSHIP = /\b(own|ownership|end-to-end|lead|drive|independently|autonomy|from scratch|0\s*(to|-)\s*1|zero to one)\b/i;
const DOMAIN = /\b(health|healthcare|clinical|fintech|payments|financial|music|education|edtech|climate|retail|e-?commerce|insurance|legal|industry|domain)\b/i;
const METRIC = /\b(metric|kpi|impact|measur|growth|conversion|retention|a\/b|experiment)\w*/i;
const SENIORITY = /\b\d+\+?\s*(years|yrs)\b|\b(senior|staff)\b/i;

export function inferGapTag(requirement: string): GapTag {
  if (SENIORITY.test(requirement)) return "seniority";
  if (TOOLING.test(requirement)) return "tooling";
  if (OWNERSHIP.test(requirement)) return "ownership";
  if (DOMAIN.test(requirement)) return "domain_visibility";
  if (METRIC.test(requirement)) return "quantified_impact";
  return "requirement_evidence";
}

/** Rules fallback: rate each requirement by keyword overlap with the best resume line. */
export function rateRequirementsByRules(jobText: string, resume: string): RequirementRating[] {
  const reqs = extractRequirements(jobText);
  const resumeLines = lines(resume).map((l) => ({ raw: stripBullet(l), kw: new Set(keywords(l)) }));
  const fallback = reqs.length ? reqs : [{ text: "General fit with the role description", weight: 1 }];
  return fallback.map(({ text, weight }) => {
    const kw = keywords(text);
    let best = { ratio: 0, line: null as string | null };
    for (const rl of resumeLines) {
      const r = overlapRatio(kw, rl.kw);
      if (r > best.ratio) best = { ratio: r, line: rl.raw };
    }
    const evidence: Evidence = best.ratio >= 0.45 ? "strong" : best.ratio >= 0.2 ? "partial" : "missing";
    return {
      requirement: text,
      evidence,
      resumeQuote: evidence === "missing" ? null : best.line,
      gapTag: evidence === "strong" ? null : inferGapTag(text),
      weight,
    };
  });
}

/** Resume-level gap checks that do not depend on any one requirement. */
export function resumeLevelGaps(resume: string, meta: JobMeta): GapTag[] {
  const gaps: GapTag[] = [];
  const bullets = lines(resume).filter(isBullet);
  if (bullets.length >= 3) {
    const quantified = bullets.filter(hasNumber).length / bullets.length;
    if (quantified < 0.5) gaps.push("quantified_impact");
  }
  const head = resume.slice(0, 500);
  const roleKw = keywords(meta.role).filter((k) => k.length > 3);
  if (roleKw.length && !roleKw.some((k) => keywords(head).includes(k))) gaps.push("summary_role_match");
  return gaps;
}

/** Drop any resume quote the model returned that is not verbatim in the resume. */
export function sanitizeRatings(ratings: RequirementRating[], resume: string): RequirementRating[] {
  return ratings.map((r) => {
    if (r.resumeQuote && !containsLoose(resume, r.resumeQuote)) {
      return { ...r, resumeQuote: null, evidence: r.evidence === "strong" ? "partial" : r.evidence, gapTag: r.gapTag ?? inferGapTag(r.requirement) };
    }
    if (r.evidence === "strong" && !r.resumeQuote) return { ...r, evidence: "partial", gapTag: r.gapTag ?? inferGapTag(r.requirement) };
    return r;
  });
}

export function buildFitReport(meta: JobMeta, ratings: RequirementRating[], resume: string, source: "ai" | "rules"): FitReport {
  const clean = sanitizeRatings(ratings, resume);
  const gapSet = new Set<GapTag>();
  for (const r of clean) if (r.evidence !== "strong" && r.gapTag) gapSet.add(r.gapTag);
  for (const g of resumeLevelGaps(resume, meta)) gapSet.add(g);
  return { meta, ratings: clean, score: computeScore(clean), gaps: [...gapSet], source };
}

// ---- Pre-application checklist ----

export const CHECKLIST_QUESTIONS: Record<GapTag, string> = {
  ownership: "Does the resume show the level of ownership this role asks for?",
  domain_visibility: "Is your relevant domain experience visible in the top third of the page?",
  quantified_impact: "Are your most important accomplishments quantified?",
  summary_role_match: "Does your opening line match the role you are applying for?",
  requirement_evidence: "Is there a resume line that backs up every major requirement?",
  seniority: "Is this role at a level your experience supports, or is it a stretch you can explain?",
  tooling: "Are the tools this posting names visible in your skills section, if you have used them?",
};

export interface ChecklistItem {
  tag: GapTag;
  question: string;
  occurrences: number;
}

/**
 * Deterministic rule: a gap becomes a checklist question once it appears in at
 * least `minOccurrences` of the last `window` fit checks. The current report's
 * own gaps are always included so the first application still gets a checklist.
 */
export function buildChecklist(history: Pick<Application, "fit">[], current: FitReport | null, window = 10, minOccurrences = 2): ChecklistItem[] {
  const recent = history.filter((a) => a.fit).slice(-window);
  const counts = new Map<GapTag, number>();
  for (const a of recent) for (const g of a.fit!.gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
  const items: ChecklistItem[] = [];
  for (const [tag, n] of counts) if (n >= minOccurrences) items.push({ tag, question: CHECKLIST_QUESTIONS[tag], occurrences: n });
  for (const tag of current?.gaps ?? []) {
    if (!items.some((i) => i.tag === tag)) items.push({ tag, question: CHECKLIST_QUESTIONS[tag], occurrences: counts.get(tag) ?? 1 });
  }
  return items.sort((a, b) => b.occurrences - a.occurrences).slice(0, 5);
}

export const GAP_LABELS: Record<GapTag, string> = {
  ownership: "Ownership",
  domain_visibility: "Domain visibility",
  quantified_impact: "Quantified impact",
  summary_role_match: "Summary–role match",
  requirement_evidence: "Requirement evidence",
  seniority: "Seniority",
  tooling: "Tools",
};
