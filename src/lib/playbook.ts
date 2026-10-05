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
import { GAP_LABELS } from "./fit";
import { roleFamily } from "./insights";
import {
  appFeatures,
  bestContrast,
  comparisonTier,
  groupBy,
  jdPatterns,
  messageStats,
  messageTier,
  resolvedApps,
  tierProgress,
  type Tier,
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
  tier: Exclude<Tier, "job_post">;
}

export const PlaybookRule = z.object({
  key: z.string().max(200),
  scope: z.enum(RULE_SCOPES),
  family: z.string().max(80).nullable(),
  text: z.string().max(300),
  evidence: z.string().max(400),
  tier: z.enum(["early", "pattern", "strong"]),
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
  const resolved = resolvedApps(apps, now);
  const out: RuleCandidate[] = [];
  const families = [...new Set(resolved.map((r) => roleFamily(r.app.role)))];

  for (const fam of [null, ...families]) {
    const pool = fam ? resolved.filter((r) => roleFamily(r.app.role) === fam) : resolved;
    const s = pool.filter((r) => r.outcome === "success").length;
    if (pool.length < 5 || s === 0 || s === pool.length) continue;
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
      if (f >= 2 && d > 0.2 && (!best || d > best.d)) best = { g, f, w, d };
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
  const fams = groupBy(resolved, (r) => roleFamily(r.app.role)).filter((f) => f.n >= 4);
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
    if (p.lift < 0.25 || p.with.n < 3) continue;
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
    const bo = op.find((o) => o.n >= 3);
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
    const bt = types.find((t) => t.n >= 3);
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
    if (sh && lo && sh.n >= 3 && lo.n >= 3 && sh.s / sh.n - lo.s / lo.n >= 0.15) {
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
      current: true,
      updatedAt: evidenceChanged ? now : prev.updatedAt,
    });
  }
  for (const r of stored) if (!seen.has(r.key)) out.push({ ...r, current: false });
  return out;
}

/** Accepted, still-supported rules relevant to one role family. */
export function activeRules(rules: PlaybookRule[], scope: RuleScope | RuleScope[], family: string | null): PlaybookRule[] {
  const scopes = Array.isArray(scope) ? scope : [scope];
  return rules.filter((r) => r.status === "accepted" && r.current && scopes.includes(r.scope) && (r.family === null || r.family === family));
}
