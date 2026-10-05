/**
 * Scores every skill rule (baseline or learned) against the user's own
 * outcomes, overall and per job type.
 *
 * For a rule, the applications (or messages) that followed it are compared
 * with the ones that didn't. Per-job-type rates are shrunk toward the
 * all-job-types rate for the same group, so a job type with three
 * applications can't swing a rule on its own; the evidence label still uses
 * the job type's own counts.
 *
 * Each rule is scored on two results: getting a response (the main metric)
 * and getting an interview, so the app can say which insights went with
 * interviews, not just replies.
 */
import type { Application, Contact } from "../schemas";
import { familyOf, reached } from "../insights";
import { appOutcome, comparisonTier, messageOutcome, TIER_PERSONAL, type Outcome, type Tier } from "../learn";
import { BASELINE_RULES, followed, RULE_BY_ID, type RuleTarget } from "./catalog";

/** Prior strength (in pseudo-observations) when shrinking a job type toward the overall rate. */
export const SHRINK_K = 4;
/** Minimum shrunk difference in response rate before a rule is called working or not working. */
export const EFFECT = 0.1;

export function shrink(s: number, n: number, prior: number, k = SHRINK_K): number {
  return (s + k * prior) / (n + k);
}

export type RuleStatus = "working" | "not_working" | "neutral" | "untested";

/** response = any response (the main metric); interview = reached an interview. */
export type Metric = "response" | "interview";

export interface Group {
  s: number;
  n: number;
  ids: string[];
}

export interface RuleScore {
  id: string;
  metric: Metric;
  /** Job type label; null = all job types. */
  family: string | null;
  with: Group;
  without: Group;
  /** Shrunk response rate with minus without. */
  lift: number;
  tier: Tier;
  status: RuleStatus;
}

interface Obs {
  id: string;
  family: string;
  outcome: "success" | "failure";
  follow: boolean;
}

/** Interview outcome: success = reached final round or offer; failure = rejected after an interview. */
export function interviewOutcome(a: Application): Outcome {
  if (!reached(a, "interview")) return "pending";
  if (reached(a, "final_round")) return "success";
  return a.stage === "rejected" ? "failure" : "pending";
}

/**
 * Did an application lead to an interview? Success once it reaches one;
 * failure once it closes (rejected, or no response after 21 days) without one.
 */
export function interviewReach(a: Application, now: number): Outcome {
  if (reached(a, "interview")) return "success";
  if (a.stage === "rejected" || appOutcome(a, now) === "failure") return "failure";
  return "pending";
}

function ruleFollowed(a: Application, id: string, target: RuleTarget): boolean | null {
  if (target === "interview") {
    const r = RULE_BY_ID.get(id);
    return r?.check ? r.check({ app: a }) : followed(a.cv?.rules, id);
  }
  return followed(a.trace, id) ?? followed(a.cv?.rules, id);
}

function observations(id: string, target: RuleTarget, apps: Application[], contacts: Contact[], now: number, metric: Metric): Obs[] {
  const out: Obs[] = [];
  if (target === "message") {
    const byId = new Map(apps.map((a) => [a.id, a]));
    const famOf = new Map(apps.map((a) => [a.id, familyOf(a)]));
    for (const c of contacts) {
      if (!c.message) continue;
      const f = followed(c.message.ruleTrace, id);
      const app = c.applicationId ? byId.get(c.applicationId) : undefined;
      const o = metric === "interview" ? (app ? interviewReach(app, now) : "pending") : messageOutcome(c, now);
      if (f === null || o === "pending") continue;
      out.push({ id: c.id, family: (c.applicationId && famOf.get(c.applicationId)) || "Other", outcome: o, follow: f });
    }
    return out;
  }
  for (const a of apps) {
    const f = ruleFollowed(a, id, target);
    const o = target === "interview" ? interviewOutcome(a) : metric === "interview" ? interviewReach(a, now) : appOutcome(a, now);
    if (f === null || o === "pending") continue;
    out.push({ id: a.id, family: familyOf(a), outcome: o, follow: f });
  }
  return out;
}

function groups(obs: Obs[]): { w: Group; wo: Group } {
  const w: Group = { s: 0, n: 0, ids: [] };
  const wo: Group = { s: 0, n: 0, ids: [] };
  for (const o of obs) {
    const g = o.follow ? w : wo;
    g.n++;
    g.ids.push(o.id);
    if (o.outcome === "success") g.s++;
  }
  return { w, wo };
}

function tierFor(w: Group, wo: Group): Tier {
  const n = w.n + wo.n;
  const s = w.s + wo.s;
  if (n < TIER_PERSONAL || !w.n || !wo.n || s === 0 || s === n) return "job_post";
  return comparisonTier(w.n, wo.n);
}

function statusFor(tier: Tier, lift: number): RuleStatus {
  if (tier === "job_post") return "untested";
  return lift >= EFFECT ? "working" : lift <= -EFFECT ? "not_working" : "neutral";
}

/** Score one rule overall and for every job type with data. */
export function scoreRule(id: string, target: RuleTarget, apps: Application[], contacts: Contact[], now: number, metric: Metric = "response"): RuleScore[] {
  const obs = observations(id, target, apps, contacts, now, metric);
  const all = groups(obs);
  const pooled = (all.w.s + all.wo.s) / Math.max(1, all.w.n + all.wo.n);
  // Overall rates shrink toward the pooled rate; job types shrink toward the overall rate of the same group.
  const allW = shrink(all.w.s, all.w.n, pooled);
  const allWo = shrink(all.wo.s, all.wo.n, pooled);
  const overallTier = tierFor(all.w, all.wo);
  const out: RuleScore[] = [{ id, metric, family: null, with: all.w, without: all.wo, lift: allW - allWo, tier: overallTier, status: statusFor(overallTier, allW - allWo) }];
  for (const fam of [...new Set(obs.map((o) => o.family))].sort()) {
    const g = groups(obs.filter((o) => o.family === fam));
    const lift = shrink(g.w.s, g.w.n, allW) - shrink(g.wo.s, g.wo.n, allWo);
    const tier = tierFor(g.w, g.wo);
    out.push({ id, metric, family: fam, with: g.w, without: g.wo, lift, tier, status: statusFor(tier, lift) });
  }
  return out;
}

/**
 * Scores for every baseline rule plus any extra (learned) rules, on both
 * metrics. Interview-stage rules are already judged on interviews, so they
 * get only the response-metric entry (which for them means final round).
 */
export function scoreAll(apps: Application[], contacts: Contact[], now: number, extra: { id: string; target: RuleTarget }[] = []): RuleScore[] {
  const rules = [...BASELINE_RULES.filter((r) => r.check).map((r) => ({ id: r.id, target: r.target })), ...extra];
  return rules.flatMap((r) => [
    ...scoreRule(r.id, r.target, apps, contacts, now, "response"),
    ...(r.target === "interview" ? [] : scoreRule(r.id, r.target, apps, contacts, now, "interview")),
  ]);
}

/** The score that applies to one job type: its own if it has evidence, else the overall one. */
export function scoreFor(scores: RuleScore[], id: string, family: string | null, metric: Metric = "response"): RuleScore | null {
  const own = family ? scores.find((s) => s.id === id && s.family === family && s.metric === metric) : null;
  if (own && own.tier !== "job_post") return own;
  return scores.find((s) => s.id === id && s.family === null && s.metric === metric) ?? null;
}

const RESULT: Record<RuleTarget, string> = {
  cv: "got a response",
  targeting: "got a response",
  message: "were accepted",
  interview: "reached the final round",
};

export function evidenceText(s: RuleScore, target: RuleTarget): string {
  const where = s.family ? `${s.family} roles` : "All roles";
  const result = s.metric === "interview" ? "got an interview" : RESULT[target];
  return `${where}: when followed, ${s.with.s} of ${s.with.n} ${result}; when not, ${s.without.s} of ${s.without.n}.`;
}
