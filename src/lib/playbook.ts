/**
 * Personal playbook: heuristics learned from the user's own outcomes.
 *
 * Code finds candidate rules (contrasts between successes and failures),
 * the AI may reword them as short heuristics, a validator checks every
 * number in the wording against the computed evidence, and the user
 * accepts or rejects each one. Accepted rules then feed the "Craft this
 * application" card and every AI outreach draft.
 */
import { z } from "zod";
import type { Application, Contact } from "./schemas";
import { SKILL_IDS, type RuleTarget, type SkillId } from "./skills/catalog";
import { LEARNED_TIERS, RULE_ORIGINS, type RuleOrigin } from "./skills/context";
import { jobTypeProfiles } from "./jobtypes";
import { GAP_LABELS } from "./fit";
import { familyOf } from "./insights";
import {
  appFeatures,
  appOutcome,
  bestContrast,
  comparisonTier,
  groupBy,
  jdPatterns,
  messageStats,
  messageTier,
  resolvedApps,
  tierProgress,
  type Tier,
  MIN_GROUP,
} from "./learn";

export const RULE_SCOPES = ["resume", "message", "targeting"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export interface RuleCandidate {
  key: string;
  scope: RuleScope;
  /** Role family the rule applies to; null = every application. */
  family: string | null;
  text: string;
  evidence: string;
  tier: Exclude<Tier, "job_post"> | "notes";
  /** The skill this rule extends. */
  skill: SkillId;
  origin: RuleOrigin;
  /** Applications a notes-derived rule was drawn from. */
  appIds?: string[];
}

const SCOPE_TARGET: Record<RuleScope, RuleTarget> = { resume: "cv", message: "message", targeting: "targeting" };

/** Id used in traces and scores for a learned rule. */
export function learnedId(key: string): string {
  return `learned/${key}`;
}

/** Which skill an older stored rule (saved before skills existed) belongs to, from its key. */
export function skillOfKey(key: string): SkillId {
  const k = key.split("|")[0];
  if (k === "resume") return "resume-version-manager";
  if (k === "gap" || k === "lead" || k === "cover") return k === "cover" ? "resume-ats-optimizer" : "resume-tailor";
  if (k === "opener" || k === "recipient" || k === "length" || k === "network") return "cold-email-writer";
  if (k === "interview") return "interview-prep-generator";
  return "job-description-analyzer";
}

export function targetOf(r: Pick<PlaybookRule, "scope" | "key">): RuleTarget {
  return r.key.startsWith("interview|") ? "interview" : SCOPE_TARGET[r.scope];
}

export const PlaybookRule = z.object({
  key: z.string().max(200),
  scope: z.enum(RULE_SCOPES),
  family: z.string().max(80).nullable(),
  text: z.string().max(300),
  evidence: z.string().max(400),
  tier: z.enum(LEARNED_TIERS),
  skill: z.enum(SKILL_IDS).optional(),
  origin: z.enum(RULE_ORIGINS).optional(),
  appIds: z.array(z.string().max(80)).max(20).optional(),
  status: z.enum(["proposed", "accepted", "rejected"]),
  /** False when the latest data no longer supports the rule. */
  current: z.boolean(),
  source: z.enum(["ai", "rules"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PlaybookRule = z.infer<typeof PlaybookRule>;

const OPENER_PHRASE: Record<string, string> = {
  shared_school: "a shared school",
  shared_employer: "a shared employer",
  shared_field: "your shared field",
  shared_other: "the shared ground you have",
  role_led: "the role itself",
};

const RECIPIENT_PHRASE: Record<string, string> = {
  alum: "alumni",
  recruiter: "recruiters",
  hr: "HR contacts",
  hiring_manager: "hiring managers",
  team_member: "people on the team",
};

const frac = (s: number, n: number) => `${s} of ${n}`;

/** Every rule the data currently supports. Empty until personal suggestions are unlocked. */
export function ruleCandidates(apps: Application[], contacts: Contact[], now: number): RuleCandidate[] {
  if (tierProgress(apps, now).tier === "job_post") return [];
  return [
    ...outcomeCandidates(apps, contacts, now).map((c) => ({ ...c, skill: skillOfKey(c.key), origin: "outcomes" as const })),
    ...jobTypeCandidates(apps, now),
    ...leadQuoteCandidates(apps, contacts, now),
  ];
}

function outcomeCandidates(apps: Application[], contacts: Contact[], now: number): Omit<RuleCandidate, "skill" | "origin">[] {
  const resolved = resolvedApps(apps, now);
  const out: Omit<RuleCandidate, "skill" | "origin">[] = [];
  const families = [...new Set(resolved.map((r) => familyOf(r.app)))];

  for (const fam of [null, ...families]) {
    const pool = fam ? resolved.filter((r) => familyOf(r.app) === fam) : resolved;
    const s = pool.filter((r) => r.outcome === "success").length;
    // A contrast needs at least one response and one non-response; nothing more.
    if (s === 0 || s === pool.length) continue;
    const scopeTxt = fam ? `For ${fam} roles` : "Across your applications";

    const v = bestContrast(groupBy(pool, (r) => r.app.resumeVersion));
    if (v) {
      out.push({
        key: `resume|${fam ?? "all"}|${v.best.level}`,
        scope: "resume",
        family: fam,
        text: `${scopeTxt}, apply with resume ${v.best.level}.`,
        evidence: `${v.best.level}: ${frac(v.best.s, v.best.n)} got a response; other versions: ${frac(v.rest.s, v.rest.n)}.`,
        tier: v.tier,
      });
    }

    const fails = pool.filter((r) => r.outcome === "failure");
    const wins = pool.filter((r) => r.outcome === "success");
    let best: { g: string; f: number; w: number; d: number } | null = null;
    for (const g of Object.keys(GAP_LABELS)) {
      const f = fails.filter((r) => r.app.fit?.gaps.includes(g as never)).length;
      const w = wins.filter((r) => r.app.fit?.gaps.includes(g as never)).length;
      const d = f / fails.length - w / wins.length;
      if (f >= MIN_GROUP && d > 0.2 && (!best || d > best.d)) best = { g, f, w, d };
    }
    if (best) {
      out.push({
        key: `gap|${fam ?? "all"}|${best.g}`,
        scope: "resume",
        family: fam,
        text: `${scopeTxt}, fix "${GAP_LABELS[best.g as keyof typeof GAP_LABELS].toLowerCase()}" before applying.`,
        evidence: `Flagged in ${frac(best.f, fails.length)} applications with no response and ${frac(best.w, wins.length)} with a response.`,
        tier: comparisonTier(fails.length, wins.length),
      });
    }

    const net = bestContrast(groupBy(pool, (r) => (appFeatures(r.app, contacts).networkedFirst || r.app.source === "referral" ? "networked" : "cold")));
    if (net && net.best.level === "networked") {
      out.push({
        key: `network|${fam ?? "all"}`,
        scope: "targeting",
        family: fam,
        text: `${scopeTxt}, reach someone at the company before you submit.`,
        evidence: `With outreach or a referral first: ${frac(net.best.s, net.best.n)} got a response; cold: ${frac(net.rest.s, net.rest.n)}.`,
        tier: net.tier,
      });
    }
  }

  // Families that keep converting vs not at all (targeting).
  const fams = groupBy(resolved, (r) => familyOf(r.app)).filter((f) => f.n >= MIN_GROUP);
  const top = fams[0];
  const bottom = fams[fams.length - 1];
  if (top && bottom && top !== bottom && top.rate - bottom.rate >= 0.25) {
    out.push({
      key: `family|${top.level}|${bottom.level}`,
      scope: "targeting",
      family: null,
      text: `Prioritize ${top.level} roles; ${bottom.level} roles haven't been converting for you.`,
      evidence: `${top.level}: ${frac(top.s, top.n)} got a response; ${bottom.level}: ${frac(bottom.s, bottom.n)}.`,
      tier: comparisonTier(top.n, bottom.n),
    });
  }

  // Job-post vocabulary that goes with responses. Terms that appear in exactly
  // the same postings carry the same evidence, so they become one rule.
  const groups = new Map<string, { terms: string[]; p: ReturnType<typeof jdPatterns>[number] }>();
  for (const p of jdPatterns(resolved, 8)) {
    if (p.lift < 0.25 || p.with.n < MIN_GROUP) continue;
    const sig = `${p.with.s}/${p.with.n}|${p.without.s}/${p.without.n}`;
    const g = groups.get(sig) ?? { terms: [], p };
    g.terms.push(p.term);
    groups.set(sig, g);
  }
  for (const { terms, p } of [...groups.values()].slice(0, 2)) {
    const t = terms.slice(0, 3).map((x) => `"${x}"`);
    const list = t.length > 1 ? `${t.slice(0, -1).join(", ")} or ${t[t.length - 1]}` : t[0];
    out.push({
      key: `term|${terms.slice(0, 3).sort().join("+")}`,
      scope: "targeting",
      family: null,
      text: `Postings that ask for ${list} respond to you more; prioritize them and mirror that wording where it's true.`,
      evidence: `Posts mentioning ${t.length > 1 ? "these" : "it"}: ${frac(p.with.s, p.with.n)} got a response; others: ${frac(p.without.s, p.without.n)}.`,
      tier: comparisonTier(p.with.n, p.without.n),
    });
  }

  // Messages.
  const sent = contacts.filter((c) => c.message && c.message.opener !== "template");
  const all = messageStats(sent, now, () => "all")[0];
  if (all && messageTier(all.s, all.n) !== "job_post") {
    const op = messageStats(sent, now, (c) => c.message!.opener);
    const bo = op.find((o) => o.n >= MIN_GROUP);
    const rest = bo ? op.filter((o) => o !== bo).reduce((a, t) => ({ s: a.s + t.s, n: a.n + t.n }), { s: 0, n: 0 }) : null;
    if (bo && rest && rest.n && bo.s / bo.n - rest.s / rest.n >= 0.15) {
      out.push({
        key: `opener|${bo.key}`,
        scope: "message",
        family: null,
        text: `Open outreach with ${OPENER_PHRASE[bo.key] ?? bo.key} whenever it's real.`,
        evidence: `Accepted ${frac(bo.s, bo.n)} times; other openings ${frac(rest.s, rest.n)}.`,
        tier: comparisonTier(bo.n, rest.n),
      });
    }
    const types = messageStats(contacts.filter((c) => c.message), now, (c) => c.recipientType);
    const bt = types.find((t) => t.n >= MIN_GROUP);
    const trest = bt ? types.filter((t) => t !== bt).reduce((a, t) => ({ s: a.s + t.s, n: a.n + t.n }), { s: 0, n: 0 }) : null;
    if (bt && trest && trest.n && bt.s / bt.n - trest.s / trest.n >= 0.15) {
      out.push({
        key: `recipient|${bt.key}`,
        scope: "message",
        family: null,
        text: `Message ${RECIPIENT_PHRASE[bt.key] ?? bt.key} first.`,
        evidence: `They accepted ${frac(bt.s, bt.n)} invites; everyone else ${frac(trest.s, trest.n)}.`,
        tier: comparisonTier(bt.n, trest.n),
      });
    }
    const len = messageStats(sent, now, (c) => (c.message!.chars < 150 ? "short" : "long"));
    const sh = len.find((x) => x.key === "short");
    const lo = len.find((x) => x.key === "long");
    if (sh && lo && sh.n >= MIN_GROUP && lo.n >= MIN_GROUP && sh.s / sh.n - lo.s / lo.n >= 0.15) {
      out.push({
        key: "length|short",
        scope: "message",
        family: null,
        text: "Keep invite notes under 150 characters.",
        evidence: `Under 150: ${frac(sh.s, sh.n)} accepted; longer: ${frac(lo.s, lo.n)}.`,
        tier: comparisonTier(sh.n, lo.n),
      });
    }
  }
  return out;
}

/** Rules from job-type patterns: requirements worth showing, and posts worth favoring. */
export function jobTypeCandidates(apps: Application[], now: number): RuleCandidate[] {
  const out: RuleCandidate[] = [];
  for (const p of jobTypeProfiles(apps, now)) {
    if (p.tier === "job_post") continue;
    for (const c of p.coverage.slice(0, 2)) {
      if (c.lift < 0.25) continue;
      out.push({
        key: `cover|${p.family}|${c.term.toLowerCase()}`,
        scope: "resume",
        family: p.family,
        text: `For ${p.family} roles, when the post asks for "${c.term}", show it near the top of your resume, only where it's true.`,
        evidence: `${p.family} posts asking for "${c.term}": shown on your resume ${frac(c.covered.s, c.covered.n)} got a response; not shown ${frac(c.uncovered.s, c.uncovered.n)}.`,
        tier: c.tier,
        skill: "resume-ats-optimizer",
        origin: "job_type",
      });
    }
    for (const f of p.posts.slice(0, 2)) {
      out.push({
        key: `post|${p.family}|${f.feature}|${f.best.level}`,
        scope: "targeting",
        family: p.family,
        text: `For ${p.family} roles, favor posts where ${f.feature.toLowerCase()} is "${f.best.level}".`,
        evidence: `${p.family}, ${f.feature.toLowerCase()} "${f.best.level}": ${frac(f.best.s, f.best.n)} got a response; other posts ${frac(f.rest.s, f.rest.n)}.`,
        tier: f.tier,
        skill: "job-description-analyzer",
        origin: "job_type",
      });
    }
  }
  return out;
}

/**
 * Outreach into the CV: a resume line your messages led with, when outreach
 * that led with it went on to a response more often than your other outreach.
 */
export function leadQuoteCandidates(apps: Application[], contacts: Contact[], now: number): RuleCandidate[] {
  const byApp = new Map(apps.map((a) => [a.id, a]));
  const groups = new Map<string, { s: number; n: number; fams: Map<string, number> }>();
  let total = { s: 0, n: 0 };
  for (const c of contacts) {
    const q = c.message?.leadQuote;
    const a = c.applicationId ? byApp.get(c.applicationId) : undefined;
    if (!q || !a) continue;
    const o = appOutcome(a, now);
    if (o === "pending") continue;
    const g = groups.get(q) ?? { s: 0, n: 0, fams: new Map() };
    g.n++;
    if (o === "success") g.s++;
    g.fams.set(familyOf(a), (g.fams.get(familyOf(a)) ?? 0) + 1);
    groups.set(q, g);
    total = { s: total.s + (o === "success" ? 1 : 0), n: total.n + 1 };
  }
  const out: RuleCandidate[] = [];
  for (const [q, g] of groups) {
    const rest = { s: total.s - g.s, n: total.n - g.n };
    if (g.s < MIN_GROUP || !rest.n || g.s / g.n - rest.s / rest.n < 0.2) continue;
    const fam = [...g.fams.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      key: `lead|${fam}|${q.toLowerCase().slice(0, 80)}`,
      scope: "resume",
      family: fam,
      text: `For ${fam} roles, keep "${q}" in your top three bullets; it's what your successful outreach led with.`,
      evidence: `Outreach leading with this line: ${frac(g.s, g.n)} applications got a response; other outreach: ${frac(rest.s, rest.n)}.`,
      tier: comparisonTier(g.n, rest.n),
      skill: "resume-tailor",
      origin: "outreach",
    });
  }
  return out.slice(0, 3);
}

/** Merge fresh candidates into stored rules, keeping the user's accept/reject decisions. */
export function syncRules(stored: PlaybookRule[], candidates: RuleCandidate[], now: number): PlaybookRule[] {
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const seen = new Set<string>();
  const out: PlaybookRule[] = [];
  for (const c of candidates) {
    seen.add(c.key);
    const prev = byKey.get(c.key);
    if (!prev) {
      out.push({ ...c, status: "proposed", current: true, source: "rules", createdAt: now, updatedAt: now });
      continue;
    }
    const evidenceChanged = prev.evidence !== c.evidence;
    out.push({
      ...prev,
      // Reworded text is kept only while its numbers still match the evidence.
      text: evidenceChanged && prev.source === "ai" ? c.text : prev.text,
      source: evidenceChanged ? "rules" : prev.source,
      evidence: c.evidence,
      tier: c.tier,
      skill: c.skill,
      origin: c.origin,
      current: true,
      updatedAt: evidenceChanged ? now : prev.updatedAt,
    });
  }
  // Notes-derived rules aren't recomputed from counts; they keep their own state.
  for (const r of stored) if (!seen.has(r.key)) out.push({ ...r, current: r.origin === "notes" ? r.current : false });
  return out;
}

/** Accepted, still-supported rules relevant to one role family. */
export function activeRules(rules: PlaybookRule[], scope: RuleScope | RuleScope[], family: string | null): PlaybookRule[] {
  const scopes = Array.isArray(scope) ? scope : [scope];
  return rules.filter((r) => r.status === "accepted" && r.current && scopes.includes(r.scope) && (r.family === null || r.family === family));
}
