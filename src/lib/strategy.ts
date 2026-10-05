/**
 * Strategy engine: patterns, next best targets, apply-next ranking, resume
 * tweak candidates, and language fixes. All ranking and counting happens
 * here. The AI may only phrase explanations around these computed facts.
 */
import type { Application, GapTag } from "./schemas";
import { CHECKLIST_QUESTIONS, GAP_LABELS } from "./fit";
import { furthestStage, isApplied, reached, roleFamily, rate, type Rate } from "./insights";
import { hasNumber, isBullet, keywords, lines, stripBullet } from "./text";

/** Counts shown on the next-steps card. There is no gate: advice is labeled by evidence tier instead. */
export function strategyStatus(apps: Application[]): { applied: number; outcomes: number } {
  const applied = apps.filter(isApplied).length;
  const outcomes = apps.filter((a) => a.stage === "rejected" || a.stage === "offer" || reached(a, "interview")).length;
  return { applied, outcomes };
}

export interface StallPoint {
  label: string;
  count: number;
}

/** Where rejected applications stopped. */
export function stallPoints(apps: Application[]): StallPoint[] {
  const labels: Record<string, string> = {
    applied: "No response before rejection",
    responded: "After a first response",
    interview: "During interviews",
    final_round: "At the final round",
    saved: "Before applying",
    offer: "After an offer",
  };
  const m = new Map<string, number>();
  for (const a of apps.filter((x) => x.stage === "rejected")) {
    const s = furthestStage(a);
    m.set(labels[s], (m.get(labels[s]) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export interface Target {
  family: string;
  seniority: string;
  avgFit: number;
  progress: Rate;
  score: number;
  /** Strongest resume line backing the most common requirement in this group. */
  evidence: { requirement: string; resumeQuote: string } | null;
}

/** Rank role family × seniority by 0.6·fit + 0.4·progress-past-screen rate. */
export function nextTargets(apps: Application[], limit = 3): Target[] {
  const groups = new Map<string, Application[]>();
  for (const a of apps.filter(isApplied)) {
    const key = `${roleFamily(a.role)}|${a.seniority}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const out: Target[] = [];
  for (const [key, as] of groups) {
    const [family, seniority] = key.split("|");
    const withFit = as.filter((a) => a.fit);
    const avgFit = withFit.length ? withFit.reduce((s, a) => s + a.fit!.score, 0) / withFit.length : 0;
    const progress = rate(key, as.filter((a) => reached(a, "responded")).length, as.length);
    const strong = withFit.flatMap((a) => a.fit!.ratings.filter((r) => r.evidence === "strong" && r.resumeQuote));
    out.push({
      family,
      seniority,
      avgFit: Math.round(avgFit),
      progress,
      score: Math.round(100 * (0.6 * (avgFit / 100) + 0.4 * progress.rate)),
      evidence: strong[0] ? { requirement: strong[0].requirement, resumeQuote: strong[0].resumeQuote! } : null,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface ApplyNext {
  id: string;
  role: string;
  company: string | null;
  score: number;
  gaps: GapTag[];
}

export function applyNext(apps: Application[], limit = 5): ApplyNext[] {
  return apps
    .filter((a) => a.stage === "saved" && a.fit)
    .sort((a, b) => b.fit!.score - a.fit!.score)
    .slice(0, limit)
    .map((a) => ({ id: a.id, role: a.role, company: a.company, score: a.fit!.score, gaps: a.fit!.gaps.slice(0, 2) }));
}

export interface ResumeTweak {
  original: string;
  gap: GapTag;
  issue: string;
  /** Problem → action → outcome scaffold. Bracketed parts need the user's real facts. */
  scaffold: string;
  needsInput: string[];
}

/**
 * Pick resume bullets to strengthen against the most frequent gaps. Never
 * invents facts: anything not already in the bullet becomes a "needs input".
 */
export function resumeTweaks(resume: string, topGaps: GapTag[], limit = 3): ResumeTweak[] {
  const bullets = lines(resume).filter(isBullet).map(stripBullet);
  const tweaks: ResumeTweak[] = [];
  const used = new Set<string>();
  for (const gap of topGaps) {
    let candidate: string | undefined;
    if (gap === "quantified_impact") candidate = bullets.find((b) => !hasNumber(b) && !used.has(b));
    else if (gap === "ownership") candidate = bullets.find((b) => !/\b(led|owned|drove|architected|launched|designed)\b/i.test(b) && !used.has(b));
    else candidate = bullets.find((b) => !used.has(b));
    if (!candidate) continue;
    used.add(candidate);
    const action = candidate.replace(/\.$/, "");
    const needsInput =
      gap === "quantified_impact" ? ["the measurable result (a number, %, or time saved)"] :
      gap === "ownership" ? ["what you personally decided or owned"] :
      gap === "domain_visibility" ? ["the industry or user this served"] :
      gap === "tooling" ? ["the tools you actually used"] :
      gap === "seniority" ? ["the scope: team size, users, or budget"] : ["which job requirement this proves"];
    const scaffold =
      gap === "tooling"
        ? `${action} using [${needsInput[0]}].`
        : `[Problem you noticed], so I ${lowerFirst(action)}, which led to [${needsInput[0]}].`;
    tweaks.push({ original: candidate, gap, issue: CHECKLIST_QUESTIONS[gap], scaffold, needsInput });
    if (tweaks.length >= limit) break;
  }
  return tweaks;
}

const SYNONYMS: [string, string[]][] = [
  ["experimentation", ["evaluation", "testing", "benchmarking"]],
  ["stakeholders", ["cross-functional", "partners", "teams"]],
  ["shipped", ["built", "developed", "implemented"]],
  ["product sense", ["requirements", "user needs"]],
  ["growth", ["adoption", "engagement"]],
  ["front-end", ["ui", "interface"]],
  ["a/b test", ["experiment", "evaluation"]],
  ["metrics", ["kpis", "accuracy", "benchmarks"]],
];

export interface LanguageFix {
  marketTerm: string;
  jdShare: number;
  yourTerm: string | null;
}

/**
 * Terms that show up in a large share of your saved job posts but not in your
 * resume. When your resume uses a near-synonym, say which one to swap.
 */
export function languageFixes(apps: Application[], resume: string, limit = 5): LanguageFix[] {
  const jds = apps.map((a) => a.jobText.toLowerCase()).filter(Boolean);
  if (jds.length < 2) return [];
  const resumeLc = resume.toLowerCase();
  const resumeKw = new Set(keywords(resume));
  const fixes: LanguageFix[] = [];
  for (const [term, syns] of SYNONYMS) {
    const share = jds.filter((j) => j.includes(term)).length / jds.length;
    if (share < 0.4 || resumeLc.includes(term)) continue;
    fixes.push({ marketTerm: term, jdShare: share, yourTerm: syns.find((s) => resumeLc.includes(s)) ?? null });
  }
  // Generic frequent keywords missing from the resume.
  const df = new Map<string, number>();
  for (const j of jds) for (const k of new Set(keywords(j))) df.set(k, (df.get(k) ?? 0) + 1);
  for (const [k, n] of [...df.entries()].sort((a, b) => b[1] - a[1])) {
    if (fixes.length >= limit) break;
    const share = n / jds.length;
    if (share < 0.5 || k.length < 4 || resumeKw.has(k) || fixes.some((f) => f.marketTerm.includes(k))) continue;
    fixes.push({ marketTerm: k, jdShare: share, yourTerm: null });
  }
  return fixes.slice(0, limit);
}

/** Applications that reached the final round and were then rejected. */
export function finalRoundRejections(apps: Application[]): Application[] {
  return apps.filter((a) => a.stage === "rejected" && a.history.some((h) => h.stage === "final_round"));
}

export interface StrategyFacts {
  status: ReturnType<typeof strategyStatus>;
  stalls: StallPoint[];
  targets: Target[];
  apply: ApplyNext[];
  tweaks: ResumeTweak[];
  language: LanguageFix[];
  topGaps: { tag: GapTag; label: string; count: number }[];
}

export function buildStrategyFacts(apps: Application[], resume: string): StrategyFacts {
  const gapCounts = new Map<GapTag, number>();
  for (const a of apps) for (const g of a.fit?.gaps ?? []) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
  const topGaps = [...gapCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag, count]) => ({ tag, label: GAP_LABELS[tag], count }));
  return {
    status: strategyStatus(apps),
    stalls: stallPoints(apps),
    targets: nextTargets(apps),
    apply: applyNext(apps),
    tweaks: resumeTweaks(resume, topGaps.map((g) => g.tag)),
    language: languageFixes(apps, resume),
    topGaps,
  };
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
