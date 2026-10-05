/**
 * Insights dashboard metrics. Every rate carries its count and a Wilson
 * interval, and small groups are marked so nobody over-reads five data points.
 */
import type { AppStage, Application, Contact, GapTag, JobType } from "./schemas";
import { MIN_GROUP_N, wilson, type Interval } from "./stats";

export interface Rate {
  key: string;
  k: number;
  n: number;
  rate: number;
  ci: Interval;
  enough: boolean;
}

export function rate(key: string, k: number, n: number): Rate {
  return { key, k, n, rate: n ? k / n : 0, ci: wilson(k, n), enough: n >= MIN_GROUP_N };
}

const ORDER: AppStage[] = ["saved", "applied", "responded", "interview", "final_round", "offer"];

/** Furthest stage an application ever reached (rejection does not erase progress). */
export function furthestStage(app: Pick<Application, "history" | "stage">): AppStage {
  let best = 0;
  for (const h of [...app.history, { stage: app.stage, at: 0 }]) {
    const i = ORDER.indexOf(h.stage as AppStage);
    if (i > best) best = i;
  }
  return ORDER[best];
}

export function reached(app: Pick<Application, "history" | "stage">, stage: AppStage): boolean {
  return ORDER.indexOf(furthestStage(app)) >= ORDER.indexOf(stage);
}

export function isApplied(a: Pick<Application, "stage" | "history">): boolean {
  return a.stage !== "saved" || a.history.some((h) => h.stage !== "saved");
}

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  data_analytics: "Data analytics",
  analytics_engineering: "Analytics engineering",
  data_engineering: "Data engineering",
  product: "Product",
  data_science_ml: "Data science / ML",
  growth: "Growth",
  ai_engineering: "AI engineering",
  software_engineering: "Software engineering",
  other: "Other",
};

/** Best guess of the job type from a title. Order matters: "analytics engineer" before "analyst". */
export function jobTypeOf(role: string): JobType {
  const r = role.toLowerCase();
  if (/product manager|\bpm\b|product owner|\bapm\b|accelerator|product analyst/.test(r)) return "product";
  if (/analytics engineer|bi engineer/.test(r)) return "analytics_engineering";
  if (/data engineer|etl|data platform/.test(r)) return "data_engineering";
  if (/data scien|machine learning|\bml\b/.test(r)) return "data_science_ml";
  if (/analyst|analytics|business intelligence|\bbi\b/.test(r)) return "data_analytics";
  if (/growth/.test(r)) return "growth";
  if (/\bai\b|agent|llm/.test(r)) return "ai_engineering";
  if (/engineer|developer|swe/.test(r)) return "software_engineering";
  return "other";
}

/** Display label for a job title's guessed type. */
export function roleFamily(role: string): string {
  return JOB_TYPE_LABEL[jobTypeOf(role)];
}

/** The job type an application counts under: the user's override, else the guess. */
export function jobTypeOfApp(a: { role: string; jobType?: JobType | null }): JobType {
  return a.jobType ?? jobTypeOf(a.role);
}

/** Display label of the job type an application counts under. */
export function familyOf(a: { role: string; jobType?: JobType | null }): string {
  return JOB_TYPE_LABEL[jobTypeOfApp(a)];
}

function groupRates<T>(items: T[], keyOf: (t: T) => string, hit: (t: T) => boolean): Rate[] {
  const m = new Map<string, { k: number; n: number }>();
  for (const it of items) {
    const key = keyOf(it);
    const g = m.get(key) ?? { k: 0, n: 0 };
    g.n++;
    if (hit(it)) g.k++;
    m.set(key, g);
  }
  return [...m.entries()].map(([key, g]) => rate(key, g.k, g.n)).sort((a, b) => b.n - a.n);
}

export interface Insights {
  outreachCount: number;
  applied: number;
  interviewConversion: Rate;
  rejectionByRole: Rate[];
  rejectionBySeniority: Rate[];
  topGaps: { tag: GapTag; count: number }[];
  avgAlignment: number | null;
  resumeVersions: { version: string; response: Rate; interview: Rate }[];
  responseByCompanyType: Rate[];
  fitTrend: { week: string; avg: number; n: number }[];
  strongestRoles: { family: string; avgFit: number; n: number; interview: Rate }[];
}

function weekKey(ts: number): string {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function computeInsights(apps: Application[], contacts: Contact[]): Insights {
  const outreachCount = contacts.filter((c) => c.stage !== "drafted").length;
  const applied = apps.filter(isApplied);
  const gapCounts = new Map<GapTag, number>();
  for (const a of apps) for (const g of a.fit?.gaps ?? []) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
  const fits = apps.filter((a) => a.fit).map((a) => a.fit!.score);

  const versions = [...new Set(applied.map((a) => a.resumeVersion))];
  const trend = new Map<string, { sum: number; n: number }>();
  for (const a of apps.filter((x) => x.fit)) {
    const w = weekKey(a.createdAt);
    const t = trend.get(w) ?? { sum: 0, n: 0 };
    t.sum += a.fit!.score;
    t.n++;
    trend.set(w, t);
  }
  const fam = new Map<string, Application[]>();
  for (const a of applied) fam.set(familyOf(a), [...(fam.get(familyOf(a)) ?? []), a]);

  return {
    outreachCount,
    applied: applied.length,
    interviewConversion: rate("All applications", applied.filter((a) => reached(a, "interview")).length, applied.length),
    // Denominator is every applied role; still-open applications count as not rejected (yet).
    rejectionByRole: groupRates(applied, (a) => familyOf(a), (a) => a.stage === "rejected"),
    rejectionBySeniority: groupRates(applied, (a) => a.seniority, (a) => a.stage === "rejected"),
    topGaps: [...gapCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    avgAlignment: fits.length ? Math.round(fits.reduce((s, x) => s + x, 0) / fits.length) : null,
    resumeVersions: versions.map((v) => {
      const vs = applied.filter((a) => a.resumeVersion === v);
      return {
        version: v,
        response: rate(v, vs.filter((a) => reached(a, "responded")).length, vs.length),
        interview: rate(v, vs.filter((a) => reached(a, "interview")).length, vs.length),
      };
    }),
    responseByCompanyType: groupRates(applied, (a) => a.companyType, (a) => reached(a, "responded")),
    fitTrend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, t]) => ({ week, avg: Math.round(t.sum / t.n), n: t.n })),
    strongestRoles: [...fam.entries()]
      .map(([family, as]) => {
        const f = as.filter((a) => a.fit);
        return {
          family,
          avgFit: f.length ? Math.round(f.reduce((s, a) => s + a.fit!.score, 0) / f.length) : 0,
          n: as.length,
          interview: rate(family, as.filter((a) => reached(a, "interview")).length, as.length),
        };
      })
      .sort((a, b) => b.avgFit - a.avgFit)
      .slice(0, 5),
  };
}
