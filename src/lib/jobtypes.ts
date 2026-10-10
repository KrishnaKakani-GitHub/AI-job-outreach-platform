/**
 * Patterns per job type (Data analytics, Analytics engineering, Product, …).
 *
 * For each job type the user has applied to, compares the job posts that got
 * a response with the ones that didn't:
 *   - what those posts usually ask for;
 *   - which asks mattered, by whether the resume that went out covered them
 *     (covered vs not covered, among posts that asked);
 *   - post features: seniority, years required, number of must-haves, company type.
 * Rates are shrunk toward the user's overall rate so small job types don't
 * mislead, and every finding carries its own counts and evidence label.
 */
import type { Application } from "./schemas";
import { familyOf } from "./insights";
import { bestContrast, comparisonTier, MIN_GROUP, groupBy, historyTier, resolvedApps, surface, type Level, type Reco, type Resolved, type Tier } from "./learn";
import { evidenceText, shrink, type RuleScore } from "./skills/score";
import { RULE_BY_ID } from "./skills/catalog";
import { wilson, type Interval } from "./stats";
import { GENERIC_TERMS as GENERIC, keywords } from "./text";

export interface Coverage {
  term: string;
  covered: { s: number; n: number; ids: string[] };
  uncovered: { s: number; n: number; ids: string[] };
  lift: number;
  tier: Exclude<Tier, "job_post">;
}

export interface PostFinding {
  feature: string;
  best: Level;
  rest: { s: number; n: number; rate: number };
  tier: Exclude<Tier, "job_post">;
}

export interface JobTypeProfile {
  family: string;
  n: number;
  s: number;
  rate: number;
  /** Rate shrunk toward the overall response rate. */
  shrunk: number;
  ci: Interval;
  tier: Tier;
  /** Terms in at least 40% of this type's posts, most common first. */
  commonAsks: { term: string; share: number }[];
  coverage: Coverage[];
  posts: PostFinding[];
  ids: string[];
}

function reqText(a: Application): string {
  return a.fit?.ratings.map((r) => r.requirement).join(" ") || a.jobText;
}

/** Did the resume that went out cover a requirement term? Fit evidence first, then the frozen resume. */
export function coveredTerm(a: Application, stemTerm: string): boolean {
  for (const r of a.fit?.ratings ?? []) if (r.evidence === "strong" && keywords(r.requirement).includes(stemTerm)) return true;
  return a.cv ? keywords(a.cv.text).includes(stemTerm) : false;
}

export function yearsBand(jobText: string): string {
  const m = jobText.match(/(\d+)\s*\+?\s*(?:-|to)?\s*\d*\s*\+?\s*years?/i);
  if (!m) return "Years not stated";
  return Number(m[1]) >= 3 ? "Asks for 3+ years" : "Asks for 0 to 2 years";
}

export function mustHaveBand(a: Application): string | null {
  if (!a.fit) return null;
  const n = a.fit.ratings.filter((r) => r.weight >= 1.5).length || a.fit.ratings.length;
  return n >= 7 ? "7+ requirements" : "Up to 6 requirements";
}

function coverage(pool: Resolved[], minDocs = MIN_GROUP): Coverage[] {
  const docs = pool.map((r) => ({ r, terms: new Set(keywords(reqText(r.app))) }));
  const names = surface(pool.map((r) => reqText(r.app)));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const out: Coverage[] = [];
  for (const [t, n] of df) {
    if (n < minDocs || t.length < 3 || GENERIC.has(t)) continue;
    const cov = { s: 0, n: 0, ids: [] as string[] };
    const unc = { s: 0, n: 0, ids: [] as string[] };
    for (const d of docs) {
      if (!d.terms.has(t)) continue;
      const g = coveredTerm(d.r.app, t) ? cov : unc;
      g.n++;
      g.ids.push(d.r.app.id);
      if (d.r.outcome === "success") g.s++;
    }
    if (cov.n < MIN_GROUP || unc.n < MIN_GROUP) continue;
    const lift = cov.s / cov.n - unc.s / unc.n;
    if (lift <= 0) continue;
    out.push({ term: names.get(t) ?? t, covered: cov, uncovered: unc, lift, tier: comparisonTier(cov.n, unc.n) });
  }
  return out.sort((a, b) => b.lift - a.lift || b.covered.n - a.covered.n);
}

function postFindings(pool: Resolved[]): PostFinding[] {
  const features: [string, (r: Resolved) => string | null][] = [
    ["Seniority", (r) => (r.app.seniority === "unknown" ? null : r.app.seniority === "senior" || r.app.seniority === "mid" ? "Mid or senior level" : "Entry level or internship")],
    ["Years required", (r) => yearsBand(r.app.jobText)],
    ["Must-haves", (r) => mustHaveBand(r.app)],
    ["Company type", (r) => (r.app.companyType === "unknown" ? null : r.app.companyType)],
  ];
  const out: PostFinding[] = [];
  for (const [feature, key] of features) {
    const c = bestContrast(groupBy(pool, key));
    if (c && c.lift >= 0.15) out.push({ feature, best: c.best, rest: c.rest, tier: c.tier });
  }
  return out;
}

export function jobTypeProfiles(apps: Application[], now: number): JobTypeProfile[] {
  const resolved = resolvedApps(apps, now);
  const overall = resolved.length ? resolved.filter((r) => r.outcome === "success").length / resolved.length : 0;
  const byFam = new Map<string, Resolved[]>();
  for (const r of resolved) byFam.set(familyOf(r.app), [...(byFam.get(familyOf(r.app)) ?? []), r]);
  const out: JobTypeProfile[] = [];
  for (const [family, pool] of byFam) {
    const s = pool.filter((r) => r.outcome === "success").length;
    const n = pool.length;
    const docs = pool.map((r) => new Set(keywords(reqText(r.app))));
    const names = surface(pool.map((r) => reqText(r.app)));
    const df = new Map<string, number>();
    for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
    const commonAsks = [...df.entries()]
      .filter(([t, c]) => c / n >= 0.4 && t.length >= 3 && !GENERIC.has(t))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, c]) => ({ term: names.get(t) ?? t, share: c / n }));
    const tier = historyTier(s, n - s);
    out.push({
      family,
      n,
      s,
      rate: n ? s / n : 0,
      shrunk: shrink(s, n, overall),
      ci: wilson(s, n),
      tier,
      commonAsks,
      coverage: tier === "job_post" ? [] : coverage(pool).slice(0, 5),
      posts: tier === "job_post" ? [] : postFindings(pool),
      ids: pool.map((r) => r.app.id),
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

export function profileFor(profiles: JobTypeProfile[], family: string): JobTypeProfile | null {
  return profiles.find((p) => p.family === family) ?? null;
}

/** One-line, number-carrying statements about a job type, used in prompts and the skill files. */
export function profileFacts(p: JobTypeProfile): string[] {
  const out: string[] = [`${p.family}: ${p.s} of ${p.n} applications got a response.`];
  for (const c of p.coverage.slice(0, 3)) {
    out.push(`${p.family} posts asking for "${c.term}": when your resume showed it, ${c.covered.s} of ${c.covered.n} got a response; when it didn't, ${c.uncovered.s} of ${c.uncovered.n}.`);
  }
  for (const f of p.posts.slice(0, 2)) {
    out.push(`${p.family}, ${f.feature.toLowerCase()} "${f.best.level}": ${f.best.s} of ${f.best.n} got a response; other posts ${f.rest.s} of ${f.rest.n}.`);
  }
  return out;
}

// ---- Targeting and per-post suggestions ----

export type Signal = "apply_more" | "apply_less" | "unclear";

/**
 * Where to apply more or less: compare this job type's 95% range with your
 * overall response rate. Only a range entirely above (or below) it counts.
 */
export function targetingSignal(p: JobTypeProfile, overall: number): Signal {
  if (p.tier === "job_post") return "unclear";
  if (p.ci.low > overall) return "apply_more";
  if (p.ci.high < overall) return "apply_less";
  return "unclear";
}

export const SIGNAL_TEXT: Record<Signal, string> = {
  apply_more: "Apply more",
  apply_less: "Apply less",
  unclear: "Not clear yet",
};

export function overallRate(apps: Application[], now: number): number {
  const r = resolvedApps(apps, now);
  return r.length ? r.filter((x) => x.outcome === "success").length / r.length : 0;
}

export interface PostInput {
  jobText: string;
  fit: { ratings: { requirement: string }[] } | null;
  resume: string;
}

/**
 * Suggestions for one post from its job type's profile, matched against the
 * resume you have now: requirements that went with responses when your
 * resume showed them, and whether this resume shows them.
 */
export function jobTypeRecos(p: JobTypeProfile | null, post: PostInput, overall: number): Reco[] {
  if (!p) return [];
  const out: Reco[] = [];
  const asks = new Set(keywords(post.fit?.ratings.map((r) => r.requirement).join(" ") || post.jobText));
  const mine = new Set(keywords(post.resume));
  for (const c of p.coverage.slice(0, 3)) {
    const st = keywords(c.term)[0];
    if (!st || !asks.has(st)) continue;
    const shown = mine.has(st);
    const counts = `${p.family} posts asking for "${c.term}": when your resume showed it, ${c.covered.s} of ${c.covered.n} got a response; when it didn't, ${c.uncovered.s} of ${c.uncovered.n}.`;
    out.push({
      id: `jt-cover-${st}`,
      kind: "jobtype",
      title: `${p.family}: what this post asks for`,
      advice: shown ? `Keep "${c.term}" in your first three bullets or the top of your skills` : `This post asks for "${c.term}" and your resume doesn't show it`,
      why: shown ? `${counts} Your resume shows it.` : `${counts} Add it only where it's true.`,
      tier: c.tier,
      evidence: [],
    });
  }
  const signal = targetingSignal(p, overall);
  if (signal !== "unclear") {
    out.push({
      id: "jt-signal",
      kind: "jobtype",
      title: `${p.family}: where to aim`,
      advice: signal === "apply_more" ? `${p.family} is one of your strongest lanes` : `${p.family} responds to you less than your other applications`,
      why: `${p.s} of ${p.n} got a response (95% range ${Math.round(p.ci.low * 100)}% to ${Math.round(p.ci.high * 100)}%), against ${Math.round(overall * 100)}% across all your applications.`,
      tier: p.tier,
      evidence: [],
    });
  }
  return out;
}

/** Baseline advice your outcomes support for this job type, on responses and on interviews. */
export function ruleRecos(scores: RuleScore[], family: string): Reco[] {
  const out: Reco[] = [];
  for (const metric of ["response", "interview"] as const) {
    const hits = scores
      .filter((s) => s.family === family && s.metric === metric && s.status === "working" && RULE_BY_ID.get(s.id)?.target !== "message")
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 2);
    if (!hits.length) continue;
    const rule = RULE_BY_ID.get(hits[0].id)!;
    out.push({
      id: `jt-rules-${metric}`,
      kind: "jobtype",
      title: metric === "interview" ? `${family}: what went with interviews` : `${family}: what works for you`,
      advice: hits.map((h) => RULE_BY_ID.get(h.id)!.text.replace(/\.$/, "")).join(". ") + ".",
      why: evidenceText(hits[0], rule.target),
      tier: hits[0].tier,
      evidence: [],
    });
  }
  return out;
}
