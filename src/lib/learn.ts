/**
 * The learning loop. Turns the tracker's records into personal suggestions:
 * what separated your applications that got a response from the ones that
 * didn't, which outreach openings get accepted, and which job-post patterns
 * line up with success.
 *
 * Everything is computed here, deterministically, from the user's own
 * records. The AI may phrase rules around these facts but never supplies a
 * number. Suggestions always carry an evidence tier instead of being hidden
 * behind a threshold:
 *   no outcomes yet → "job_post": from the job post and resume only
 *   1+ outcome → "early": personal suggestions start immediately
 *   15+ outcomes with ≥1 success and ≥1 failure → "pattern"
 *   30+ per comparison group → "strong"
 */
import type { Application, Contact, FitReport, GapTag, JobType, Opener, RecipientType } from "./schemas";
import { GAP_LABELS } from "./fit";
import { familyOf, reached } from "./insights";
import { GENERIC_TERMS, keywords, normalize, stem } from "./text";
import { mulberry32 } from "./stats";

export const DAY = 86_400_000;
export const NO_RESPONSE_DAYS = 21;
export const MESSAGE_RESOLVE_DAYS = 14;
/**
 * Analysis starts with the first outcome. Small samples are labelled
 * "Early signal" (and show "1 of 1" style counts) instead of being hidden.
 */
export const TIER_PERSONAL = 1;
export const TIER_PATTERN = 15;
/** Smallest group a comparison or rule will use. */
export const MIN_GROUP = 1;
export const TIER_STRONG_PER_GROUP = 30;

/** "notes" = drawn from the user's own outcome notes, not yet backed by outcome counts. */
export type Tier = "job_post" | "notes" | "early" | "pattern" | "strong";
export type Outcome = "success" | "failure" | "pending";

export const TIER_LABEL: Record<Tier, string> = {
  job_post: "Based on this job post",
  notes: "From your notes",
  early: "Early signal",
  pattern: "Pattern",
  strong: "Strong pattern",
};

// ---- Outcomes ----

function appliedAt(a: Pick<Application, "appliedAt" | "history">): number | null {
  return a.appliedAt ?? a.history.find((h) => h.stage === "applied")?.at ?? null;
}

/**
 * Success = any response (responded, interview or better).
 * Failure = rejected without a response, or no response 21 days after applying.
 * Saved and withdrawn-without-response applications are not outcomes.
 */
export function appOutcome(a: Application, now: number): Outcome {
  if (a.stage === "saved") return "pending";
  if (reached(a, "responded")) return "success";
  if (a.stage === "rejected" || a.outcome?.result === "rejected" || a.outcome?.result === "no_response") return "failure";
  if (a.stage === "withdrawn") return "pending";
  const at = appliedAt(a);
  return at !== null && now - at > NO_RESPONSE_DAYS * DAY ? "failure" : "pending";
}

const ACCEPTED = new Set(["accepted", "messaged", "replied", "referral"]);

/** Message success = accepted or better. Failure = sent and nothing after 14 days. */
export function messageOutcome(c: Contact, now: number): Outcome {
  if (ACCEPTED.has(c.stage)) return "success";
  if (c.stage !== "sent") return "pending";
  const sent = c.history.find((h) => h.stage === "sent")?.at ?? c.message?.copiedAt ?? c.createdAt;
  return now - sent > MESSAGE_RESOLVE_DAYS * DAY ? "failure" : "pending";
}

export interface Resolved {
  app: Application;
  outcome: "success" | "failure";
}

export function resolvedApps(apps: Application[], now: number, excludeId?: string): Resolved[] {
  const out: Resolved[] = [];
  for (const app of apps) {
    if (app.id === excludeId) continue;
    const o = appOutcome(app, now);
    if (o !== "pending") out.push({ app, outcome: o });
  }
  return out;
}

// ---- Tiers ----

export function historyTier(successes: number, failures: number): Tier {
  const n = successes + failures;
  if (n < TIER_PERSONAL) return "job_post";
  return n >= TIER_PATTERN && successes > 0 && failures > 0 ? "pattern" : "early";
}

/** Tier for a two-group comparison (a vs b). */
export function comparisonTier(nA: number, nB: number): Exclude<Tier, "job_post"> {
  if (Math.min(nA, nB) >= TIER_STRONG_PER_GROUP) return "strong";
  if (nA + nB >= TIER_PATTERN) return "pattern";
  return "early";
}

export function messageTier(successes: number, resolved: number): Tier {
  if (resolved < TIER_PERSONAL) return "job_post";
  if (resolved >= TIER_STRONG_PER_GROUP * 2 && successes > 0) return "strong";
  return resolved >= TIER_PATTERN && successes > 0 ? "pattern" : "early";
}

export interface TierProgress {
  tier: Tier;
  resolved: number;
  successes: number;
  failures: number;
  /** What it takes to reach the next tier, in plain words; null at the top. */
  next: string | null;
}

export function tierProgress(apps: Application[], now: number): TierProgress {
  const r = resolvedApps(apps, now);
  const s = r.filter((x) => x.outcome === "success").length;
  const f = r.length - s;
  const tier = historyTier(s, f);
  let next: string | null = null;
  if (tier === "job_post") {
    next = "Personal suggestions start with your first outcome: a response, or no reply 21 days after applying.";
  } else if (tier === "early") {
    const parts: string[] = [];
    if (r.length < TIER_PATTERN) parts.push(`${TIER_PATTERN - r.length} more outcome${TIER_PATTERN - r.length === 1 ? "" : "s"}`);
    if (s === 0) parts.push("one that gets a response");
    if (f === 0) parts.push("one that doesn't");
    next = `Early signal: suggestions are live now and firm up into "Pattern" with ${parts.join(" and ")}.`;
  } else next = `Comparisons become "Strong" with ${TIER_STRONG_PER_GROUP} outcomes in each group.`;
  return { tier, resolved: r.length, successes: s, failures: f, next };
}

// ---- Features and comparisons ----

export interface AppFeatures {
  family: string;
  resumeVersion: string;
  source: string;
  networkedFirst: boolean;
  referred: boolean;
  fitBand: string;
  gaps: GapTag[];
  tweaks: GapTag[];
}

export function appFeatures(a: Application, contacts: Contact[]): AppFeatures {
  const mine = contacts.filter((c) => c.applicationId === a.id);
  const at = appliedAt(a) ?? Infinity;
  const networkedFirst = mine.some((c) => {
    const sent = c.history.find((h) => h.stage === "sent")?.at ?? c.message?.copiedAt ?? null;
    return sent !== null && sent <= at;
  });
  const score = a.fit?.score ?? null;
  return {
    family: familyOf(a),
    resumeVersion: a.resumeVersion,
    source: a.source,
    networkedFirst,
    referred: a.source === "referral" || mine.some((c) => c.stage === "referral"),
    fitBand: score === null ? "No fit check" : score >= 70 ? "Fit 70+" : score >= 50 ? "Fit 50–69" : "Fit under 50",
    gaps: a.fit?.gaps ?? [],
    tweaks: a.tweaks,
  };
}

export interface Level {
  level: string;
  s: number;
  n: number;
  rate: number;
  ids: string[];
}

export function groupBy(items: Resolved[], key: (r: Resolved) => string | null): Level[] {
  const m = new Map<string, Level>();
  for (const r of items) {
    const k = key(r);
    if (k === null) continue;
    const l = m.get(k) ?? { level: k, s: 0, n: 0, rate: 0, ids: [] };
    l.n++;
    if (r.outcome === "success") l.s++;
    l.ids.push(r.app.id);
    m.set(k, l);
  }
  return [...m.values()].map((l) => ({ ...l, rate: l.s / l.n })).sort((a, b) => b.rate - a.rate || b.n - a.n);
}

export interface Contrast {
  best: Level;
  rest: { s: number; n: number; rate: number };
  lift: number;
  tier: Exclude<Tier, "job_post">;
}

/** The level that most outperforms everything else, if any level does. */
export function bestContrast(levels: Level[], minN = MIN_GROUP): Contrast | null {
  let out: Contrast | null = null;
  for (const l of levels) {
    if (l.n < minN) continue;
    const s = levels.filter((x) => x !== l).reduce((acc, x) => ({ s: acc.s + x.s, n: acc.n + x.n }), { s: 0, n: 0 });
    if (s.n === 0) continue;
    const rest = { ...s, rate: s.s / s.n };
    const lift = l.rate - rest.rate;
    if (lift > 0 && (!out || lift > out.lift)) out = { best: l, rest, lift, tier: comparisonTier(l.n, rest.n) };
  }
  return out;
}

// ---- Similarity ----

function reqKeywords(a: Pick<Application, "fit" | "jobText">): Set<string> {
  const src = a.fit?.ratings.map((r) => r.requirement).join(" ") ?? a.jobText.slice(0, 4000);
  return new Set(keywords(src));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface SimilarityTarget {
  role: string;
  jobType?: JobType | null;
  seniority: string;
  fit: FitReport | null;
  jobText: string;
}

export function similarity(t: SimilarityTarget, a: Application): number {
  const fam = familyOf(t) === familyOf(a) ? 0.5 : 0;
  const sen = t.seniority === a.seniority ? 0.15 : 0;
  return fam + sen + 0.35 * jaccard(reqKeywords(t), reqKeywords(a));
}

export function similarResolved(t: SimilarityTarget, resolved: Resolved[], minSim = 0.5, max = 15): Resolved[] {
  return resolved
    .map((r) => ({ r, sim: similarity(t, r.app) }))
    .filter((x) => x.sim >= minSim)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, max)
    .map((x) => x.r);
}

// ---- Messages and the opener bandit ----

export interface ArmStat {
  key: string;
  s: number;
  n: number;
}

export function messageStats(contacts: Contact[], now: number, by: (c: Contact) => string | null): ArmStat[] {
  const m = new Map<string, ArmStat>();
  for (const c of contacts) {
    const o = messageOutcome(c, now);
    if (o === "pending") continue;
    const k = by(c);
    if (!k) continue;
    const a = m.get(k) ?? { key: k, s: 0, n: 0 };
    a.n++;
    if (o === "success") a.s++;
    m.set(k, a);
  }
  return [...m.values()].sort((a, b) => b.s / b.n - a.s / a.n || b.n - a.n);
}

export interface OpenerChoice {
  opener: Opener;
  greedy: Opener;
  exploring: boolean;
  stats: ArmStat[];
}

/**
 * Thompson sampling over the openers that are possible for this recipient.
 * Each arm's acceptance rate gets a Beta(1+accepted, 1+not accepted) draw;
 * the highest draw wins. Strong arms win most of the time, but weaker or
 * untried arms still get chosen occasionally, so early luck can't lock the
 * user into one style.
 */
export function chooseOpener(stats: ArmStat[], feasible: Opener[], seed: number): OpenerChoice | null {
  if (!feasible.length) return null;
  const rng = mulberry32(seed);
  const by = new Map(stats.map((s) => [s.key, s]));
  let best: { o: Opener; v: number } | null = null;
  let greedy: { o: Opener; v: number } | null = null;
  for (const o of feasible) {
    const st = by.get(o) ?? { key: o, s: 0, n: 0 };
    const draw = betaDraw(1 + st.s, 1 + st.n - st.s, rng);
    const mean = (1 + st.s) / (2 + st.n);
    if (!best || draw > best.v) best = { o, v: draw };
    if (!greedy || mean > greedy.v) greedy = { o, v: mean };
  }
  return { opener: best!.o, greedy: greedy!.o, exploring: best!.o !== greedy!.o, stats: feasible.map((o) => by.get(o) ?? { key: o, s: 0, n: 0 }) };
}

/** Beta draw via two gamma draws (Marsaglia–Tsang), seeded for reproducibility. */
export function betaDraw(a: number, b: number, rng: () => number): number {
  const x = gamma(a, rng);
  return x / (x + gamma(b, rng));
}
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      let u = 0;
      while (u === 0) u = rng();
      x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function feasibleOpeners(sharedKinds: string[]): Opener[] {
  const out: Opener[] = ["role_led"];
  if (sharedKinds.includes("school")) out.push("shared_school");
  if (sharedKinds.includes("employer")) out.push("shared_employer");
  if (sharedKinds.includes("domain")) out.push("shared_field");
  if (sharedKinds.some((k) => k === "location" || k === "affiliation")) out.push("shared_other");
  return out;
}

export interface DraftGuidance {
  opener: Opener;
  exploring: boolean;
  why: string;
  maxChars: number | null;
  rules: string[];
}

const OPENER_TEXT: Record<Opener, string> = {
  shared_school: "shared school",
  shared_employer: "shared employer",
  shared_field: "shared field",
  shared_other: "other shared ground",
  role_led: "role-led",
  template: "fill-in template",
};

/** Guidance for the next AI draft, from the user's own message history. Null until there's enough to learn from. */
export function draftGuidance(contacts: Contact[], sharedKinds: string[], now: number, seed: number, rules: string[] = []): DraftGuidance | null {
  const sent = contacts.filter((c) => c.message && c.message.opener !== "template");
  const all = messageStats(sent, now, () => "all")[0];
  if (!all || messageTier(all.s, all.n) === "job_post") return rules.length ? { opener: "role_led", exploring: false, why: "", maxChars: null, rules } : null;
  const stats = messageStats(sent, now, (c) => c.message!.opener);
  const choice = chooseOpener(stats, feasibleOpeners(sharedKinds), seed);
  if (!choice) return null;
  const st = choice.stats.find((s) => s.key === choice.opener)!;
  const why = choice.exploring
    ? `Trying a ${OPENER_TEXT[choice.opener]} opening this time (${st.s} of ${st.n} accepted so far) so one lucky reply doesn't decide your style.`
    : `${capitalize(OPENER_TEXT[choice.opener])} openings: ${st.s} of ${st.n} of your invites were accepted.`;
  const short = messageStats(sent, now, (c) => (c.message!.chars < 150 ? "short" : "long"));
  const s1 = short.find((x) => x.key === "short");
  const s2 = short.find((x) => x.key === "long");
  const maxChars = s1 && s2 && s1.n >= MIN_GROUP && s2.n >= MIN_GROUP && s1.s / s1.n > s2.s / s2.n ? 150 : null;
  return { opener: choice.opener, exploring: choice.exploring, why, maxChars, rules };
}

// ---- Job-post patterns ----

export interface TermPattern {
  term: string;
  with: { s: number; n: number };
  without: { s: number; n: number };
  lift: number;
}

/** Surface form for each stem, so patterns read as real words. */
export function surface(texts: string[]): Map<string, string> {
  const count = new Map<string, Map<string, number>>();
  for (const t of texts)
    for (const w of normalize(t).split(/[\s/]+/)) {
      const raw = w.replace(/^[.-]+|[.-]+$/g, "");
      if (raw.length < 3) continue;
      const st = stem(raw);
      const m = count.get(st) ?? new Map<string, number>();
      m.set(raw, (m.get(raw) ?? 0) + 1);
      count.set(st, m);
    }
  const out = new Map<string, string>();
  for (const [st, m] of count) out.set(st, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/** Job-post terms whose presence goes with a higher response rate in your own history. */
export function jdPatterns(resolved: Resolved[], limit = 6, minWith = MIN_GROUP): TermPattern[] {
  const docs = resolved.map((r) => ({ r, terms: new Set(keywords(r.app.fit?.ratings.map((x) => x.requirement).join(" ") || r.app.jobText)) }));
  const names = surface(resolved.map((r) => r.app.fit?.ratings.map((x) => x.requirement).join(" ") || r.app.jobText));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const out: TermPattern[] = [];
  for (const [t, n] of df) {
    if (n < minWith || n === docs.length || t.length < 3 || GENERIC_TERMS.has(t)) continue;
    const w = { s: 0, n: 0 };
    const wo = { s: 0, n: 0 };
    for (const d of docs) {
      const g = d.terms.has(t) ? w : wo;
      g.n++;
      if (d.r.outcome === "success") g.s++;
    }
    if (!wo.n) continue;
    out.push({ term: names.get(t) ?? t, with: w, without: wo, lift: w.s / w.n - wo.s / wo.n });
  }
  return out.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift) || b.with.n - a.with.n).slice(0, limit);
}

// ---- Chains: outreach → outcome ----

export interface Chain {
  appId: string;
  role: string;
  company: string | null;
  steps: string[];
  outcome: Outcome;
}

const STAGE_WORD: Record<string, string> = {
  sent: "message sent",
  accepted: "accepted",
  messaged: "follow-up sent",
  replied: "replied",
  referral: "referral",
  responded: "response",
  interview: "interview",
  final_round: "final round",
  offer: "offer",
  rejected: "rejected",
};

/** For applications with outreach, the path from first message to the furthest result. */
export function outreachChains(apps: Application[], contacts: Contact[], now: number, limit = 6): Chain[] {
  const out: Chain[] = [];
  for (const a of apps) {
    const cs = contacts.filter((c) => c.applicationId === a.id && c.message);
    if (!cs.length) continue;
    const c = cs.sort((x, y) => (ACCEPTED.has(y.stage) ? 1 : 0) - (ACCEPTED.has(x.stage) ? 1 : 0))[0];
    const who = `${c.recipientType === "alum" ? "Alum" : c.recipientType === "hiring_manager" ? "Hiring manager" : c.recipientType === "team_member" ? "Team member" : c.recipientType === "hr" ? "HR" : "Recruiter"}, ${OPENER_TEXT[c.message!.opener]} opener`;
    const cSteps = c.history.map((h) => STAGE_WORD[h.stage]).filter(Boolean);
    const aSteps = a.history.filter((h) => ["responded", "interview", "final_round", "offer", "rejected"].includes(h.stage)).map((h) => STAGE_WORD[h.stage]);
    out.push({ appId: a.id, role: a.role, company: a.company, steps: [who, ...dedupe(cSteps), ...dedupe(aSteps)], outcome: appOutcome(a, now) });
  }
  const rank = (ch: Chain) => (ch.steps.includes("offer") ? 3 : ch.steps.includes("referral") ? 2 : ch.outcome === "success" ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}

function dedupe(xs: string[]): string[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}

// ---- The "Craft this application" card ----

export interface Evidence {
  id: string;
  label: string;
  outcome: Outcome;
}

export interface Reco {
  id: string;
  kind: "lead" | "gap" | "language" | "resume" | "network" | "recipient" | "opener" | "family" | "rule" | "jobtype";
  title: string;
  advice: string;
  why: string;
  tier: Tier;
  evidence: Evidence[];
  gap?: GapTag;
}

export interface Craft {
  progress: TierProgress;
  scope: "similar" | "all" | "none";
  similarCount: number;
  /** Successes and failures in the comparison pool (similar applications, or all). */
  pool: { successes: number; failures: number };
  family: string;
  recos: Reco[];
}

export interface CraftInput {
  targetId: string | null;
  role: string;
  jobType?: JobType | null;
  seniority: string;
  fit: FitReport | null;
  jobText: string;
  resume: string;
  apps: Application[];
  contacts: Contact[];
  now: number;
  /** Accepted playbook rules (already filtered to this role family). */
  rules?: { id: string; text: string; tier: Tier }[];
}

const pctTxt = (s: number, n: number) => `${s} of ${n}`;

function evidenceOf(ids: string[], apps: Map<string, Application>, now: number, limit = 6): Evidence[] {
  return ids.slice(0, limit).flatMap((id) => {
    const a = apps.get(id);
    return a ? [{ id, label: a.company ? `${a.role} · ${a.company}` : a.role, outcome: appOutcome(a, now) }] : [];
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function craftApplication(input: CraftInput): Craft {
  const { now, apps, contacts } = input;
  const byId = new Map(apps.map((a) => [a.id, a]));
  const family = familyOf(input);
  const resolved = resolvedApps(apps, now, input.targetId ?? undefined);
  const progress = tierProgress(apps.filter((a) => a.id !== input.targetId), now);
  const recos: Reco[] = [];
  const resumeKw = new Set(keywords(input.resume));

  for (const r of input.rules ?? []) {
    recos.push({ id: `rule-${r.id}`, kind: "rule", title: "From your playbook", advice: r.text, why: "A rule you approved from your own outcome history.", tier: r.tier, evidence: [] });
  }

  // 1) Always: what this job post asks for, against your resume.
  const strong = input.fit?.ratings.filter((r) => r.evidence === "strong" && r.resumeQuote) ?? [];
  if (strong.length) {
    recos.push({
      id: "lead",
      kind: "lead",
      title: "Lead with these resume lines",
      advice: strong.slice(0, 2).map((r) => `“${r.resumeQuote}”`).join(" and "),
      why: `They're your strongest evidence for “${strong[0].requirement}”${strong[1] ? ` and “${strong[1].requirement}”` : ""}, so put them in the top third of the page.`,
      tier: "job_post",
      evidence: [],
    });
  }
  const missingTerms = new Map<string, string>();
  for (const r of input.fit?.ratings ?? []) {
    if (r.evidence === "strong") continue;
    for (const w of normalize(r.requirement).split(/\s+/)) {
      const st = stem(w);
      if (w.length >= 4 && !resumeKw.has(st) && keywords(w).length && !missingTerms.has(st)) missingTerms.set(st, w);
    }
  }
  if (missingTerms.size) {
    recos.push({
      id: "language",
      kind: "language",
      title: "Words this post uses that your resume doesn't",
      advice: [...missingTerms.values()].slice(0, 4).map((w) => `“${w}”`).join(", "),
      why: "Use them only where they truthfully describe work you did; screeners and keyword filters look for the post's own vocabulary.",
      tier: "job_post",
      evidence: [],
    });
  }

  // 2) Personal suggestions once there is something to compare.
  let scope: Craft["scope"] = "none";
  let pool: Resolved[] = [];
  if (progress.tier !== "job_post") {
    const similar = input.fit || input.jobText ? similarResolved({ role: input.role, jobType: input.jobType, seniority: input.seniority, fit: input.fit, jobText: input.jobText }, resolved) : [];
    const ss = similar.filter((r) => r.outcome === "success").length;
    if (similar.length >= TIER_PERSONAL && ss > 0 && ss < similar.length) {
      pool = similar;
      scope = "similar";
    } else {
      pool = resolved;
      scope = "all";
    }
  }
  const where = scope === "similar" ? `your ${pool.length} most similar applications` : `all ${pool.length} of your applications with an outcome`;

  // Gap to fix first.
  const targetGaps = input.fit?.gaps ?? [];
  if (pool.length) {
    const fails = pool.filter((r) => r.outcome === "failure");
    const wins = pool.filter((r) => r.outcome === "success");
    let bestGap: { g: GapTag; f: number; w: number; d: number } | null = null;
    for (const g of targetGaps) {
      const f = fails.filter((r) => r.app.fit?.gaps.includes(g)).length;
      const w = wins.filter((r) => r.app.fit?.gaps.includes(g)).length;
      const d = (fails.length ? f / fails.length : 0) - (wins.length ? w / wins.length : 0);
      if (d > 0 && (!bestGap || d > bestGap.d)) bestGap = { g, f, w, d };
    }
    if (bestGap) {
      recos.push({
        id: "gap",
        kind: "gap",
        gap: bestGap.g,
        title: "Fix this gap first",
        advice: GAP_LABELS[bestGap.g],
        why: `Across ${where}, it was flagged in ${pctTxt(bestGap.f, fails.length)} that got no response and ${pctTxt(bestGap.w, wins.length)} that did.`,
        tier: comparisonTier(fails.length, wins.length),
        evidence: evidenceOf(fails.filter((r) => r.app.fit?.gaps.includes(bestGap!.g)).map((r) => r.app.id), byId, now),
      });
    }
  }
  if (!recos.some((r) => r.kind === "gap") && targetGaps[0]) {
    recos.push({ id: "gap", kind: "gap", gap: targetGaps[0], title: "Fix this gap first", advice: GAP_LABELS[targetGaps[0]], why: "It's the first gap this job post exposes in your resume.", tier: "job_post", evidence: [] });
  }

  if (pool.length) {
    // Resume version.
    const versions = bestContrast(groupBy(pool, (r) => r.app.resumeVersion));
    if (versions) {
      recos.push({
        id: "resume",
        kind: "resume",
        title: "Resume version",
        advice: `Use resume ${versions.best.level}`,
        why: `In ${where}, ${versions.best.level} got a response ${pctTxt(versions.best.s, versions.best.n)} times; other versions ${pctTxt(versions.rest.s, versions.rest.n)}.`,
        tier: versions.tier,
        evidence: evidenceOf(versions.best.ids, byId, now),
      });
    }

    // Networking before applying.
    const feats = new Map(pool.map((r) => [r.app.id, appFeatures(r.app, contacts)]));
    const net = groupBy(pool, (r) => (feats.get(r.app.id)!.referred ? "referred" : feats.get(r.app.id)!.networkedFirst ? "messaged someone first" : "applied cold"));
    const netC = bestContrast(net);
    if (netC && netC.best.level !== "applied cold") {
      recos.push({
        id: "network",
        kind: "network",
        title: "Network before you apply",
        advice: netC.best.level === "referred" ? "Ask for a referral before you submit" : "Message someone at the company before you submit",
        why: `In ${where}, applications where you ${netC.best.level === "referred" ? "were referred" : "messaged someone first"} got a response ${pctTxt(netC.best.s, netC.best.n)} times, vs ${pctTxt(netC.rest.s, netC.rest.n)} otherwise.`,
        tier: netC.tier,
        evidence: evidenceOf(netC.best.ids, byId, now),
      });
    }

    // Role family comparison.
    const fams = groupBy(resolved, (r) => familyOf(r.app));
    const mine = fams.find((f) => f.level === family);
    const top = fams.find((f) => f.n >= MIN_GROUP && f.level !== family);
    if (mine && top && mine.n >= MIN_GROUP && top.rate > mine.rate) {
      recos.push({
        id: "family",
        kind: "family",
        title: `${family} roles vs your strongest lane`,
        advice: mine.s === 0 ? `${family} roles haven't converted yet; tailor harder or weigh them against ${top.level}` : `Your ${top.level} applications convert better than ${family}`,
        why: `${family}: ${pctTxt(mine.s, mine.n)} got a response. ${top.level}: ${pctTxt(top.s, top.n)}.`,
        tier: comparisonTier(mine.n, top.n),
        evidence: evidenceOf(mine.ids, byId, now),
      });
    }
  }

  // 3) Outreach: who to contact and how to open.
  const sent = contacts.filter((c) => c.message || ACCEPTED.has(c.stage) || c.stage === "sent");
  const allMsgs = messageStats(sent, now, () => "all")[0];
  if (allMsgs && messageTier(allMsgs.s, allMsgs.n) !== "job_post") {
    const byType = messageStats(sent, now, (c) => c.recipientType);
    const referrals = new Map<RecipientType, number>();
    for (const c of contacts) if (c.stage === "referral") referrals.set(c.recipientType, (referrals.get(c.recipientType) ?? 0) + 1);
    const bestType = byType.find((t) => t.n >= MIN_GROUP);
    if (bestType) {
      const label = { alum: "an alum", recruiter: "a recruiter", hr: "someone in HR", hiring_manager: "the hiring manager", team_member: "someone on the team" }[bestType.key as RecipientType];
      const refs = referrals.get(bestType.key as RecipientType) ?? 0;
      const totalRefs = [...referrals.values()].reduce((a, b) => a + b, 0);
      const others = byType.filter((t) => t !== bestType).reduce((a, t) => ({ s: a.s + t.s, n: a.n + t.n }), { s: 0, n: 0 });
      recos.push({
        id: "recipient",
        kind: "recipient",
        title: "Who to message",
        advice: `Start with ${label}`,
        why: `They accepted ${pctTxt(bestType.s, bestType.n)} of your invites${others.n ? ` (everyone else: ${pctTxt(others.s, others.n)})` : ""}${refs ? ` and produced ${refs} of your ${totalRefs} referrals` : ""}.`,
        tier: messageTier(bestType.s, bestType.n) === "job_post" ? "early" : messageTier(bestType.s, bestType.n),
        evidence: [],
      });
    }
    const byOpener = messageStats(
      sent.filter((c) => c.message),
      now,
      (c) => c.message!.opener,
    );
    const bo = byOpener.find((o) => o.n >= MIN_GROUP);
    if (bo) {
      const rest = byOpener.filter((o) => o !== bo).reduce((a, t) => ({ s: a.s + t.s, n: a.n + t.n }), { s: 0, n: 0 });
      recos.push({
        id: "opener",
        kind: "opener",
        title: "How to open",
        advice: bo.key === "role_led" ? "Lead with the role" : `Open with ${OPENER_TEXT[bo.key as Opener]} when you have it`,
        why: `${capitalize(OPENER_TEXT[bo.key as Opener])} openings were accepted ${pctTxt(bo.s, bo.n)} times${rest.n ? `; other openings ${pctTxt(rest.s, rest.n)}` : ""}. Drafts still try other openings now and then so the lesson keeps getting tested.`,
        tier: rest.n ? comparisonTier(bo.n, rest.n) : "early",
        evidence: [],
      });
    }
  }

  const ps = pool.filter((r) => r.outcome === "success").length;
  return { progress, scope, similarCount: scope === "similar" ? pool.length : 0, pool: { successes: ps, failures: pool.length - ps }, family, recos };
}
