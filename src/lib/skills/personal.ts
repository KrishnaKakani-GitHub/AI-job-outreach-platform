/**
 * Personal skills: each baseline skill plus what the user's own outcomes
 * taught it. Pure functions; the client stores versions and the server
 * loads the baseline text.
 *
 * A personal skill has four learned parts:
 *   - rules the user accepted (from outcomes, job-type patterns, outreach, or notes);
 *   - baseline advice their outcomes support (per job type);
 *   - baseline advice their outcomes don't support, which is paused;
 *   - nothing else. Proposed rules wait for the user and never reach the model.
 */
import { fnv1a } from "../ab";
import { betaDraw } from "../learn";
import type { PlaybookRule } from "../playbook";
import { learnedId, skillOfKey, targetOf } from "../playbook";
import { mulberry32 } from "../stats";
import { BASELINE_RULES, RULE_BY_ID, SKILL_IDS, SKILLS, SKILLS_FOR, type BaselineRule, type SkillId, type SkillUse } from "./catalog";
import { TIER_TEXT, type LearnedRuleRef, type SkillContext } from "./context";
import { evidenceText, scoreFor, type RuleScore } from "./score";

export const HOUSE_RULES = [
  "Never invent experience, employers, schools, names, tools or numbers. Use only what is in the user's resume and the job post.",
  "Where a number would help but isn't in the resume, write [add metric] for the user to fill in.",
  "Learned rules below come from this user's own outcomes. Where they conflict with the baseline advice, follow the learned rules.",
  "No em dashes.",
];

export interface ScoredBaseline {
  rule: BaselineRule;
  score: RuleScore;
}

export interface PersonalSkill<R extends PlaybookRule = PlaybookRule> {
  id: SkillId;
  name: string;
  accepted: R[];
  proposed: R[];
  working: ScoredBaseline[];
  paused: ScoredBaseline[];
  /** Baseline advice that went with getting interviews. */
  interviews: ScoredBaseline[];
  /** The learned part of the skill file, rendered as markdown. */
  learnedMd: string;
  /** Hash of learnedMd; a new personal version starts when it changes. */
  signature: string;
  /** One line per learned item, used to describe what changed between versions. */
  items: string[];
}

export function ruleSkill(r: Pick<PlaybookRule, "skill" | "key">): SkillId {
  return r.skill ?? skillOfKey(r.key);
}

const fam = (f: string | null) => f ?? "All roles";
/** "for Analytics engineering" or "across all roles". */
const forFam = (f: string | null) => (f ? `for ${f}` : "across all roles");

function groupLines<T>(xs: T[], family: (x: T) => string | null, line: (x: T) => string): string[] {
  const by = new Map<string, string[]>();
  for (const x of xs) by.set(fam(family(x)), [...(by.get(fam(family(x))) ?? []), line(x)]);
  const keys = [...by.keys()].sort((a, b) => (a === "All roles" ? -1 : b === "All roles" ? 1 : a.localeCompare(b)));
  return keys.flatMap((k) => [`### ${k}`, ...by.get(k)!, ""]);
}

/** One versioned item: a stable key, what it says, and the evidence behind it. */
function item(key: string, label: string, evidence: string): string {
  return [key, label, evidence].join(SEP);
}
const SEP = " || ";

export function personalSkills<R extends PlaybookRule>(rules: R[], scores: RuleScore[]): PersonalSkill<R>[] {
  return SKILL_IDS.map((id) => {
    const mine = rules.filter((r) => ruleSkill(r) === id && r.current);
    const accepted = mine.filter((r) => r.status === "accepted");
    const proposed = mine.filter((r) => r.status === "proposed");
    const working: ScoredBaseline[] = [];
    const paused: ScoredBaseline[] = [];
    const interviews: ScoredBaseline[] = [];
    for (const rule of BASELINE_RULES.filter((r) => r.skill === id && r.check)) {
      for (const score of scores.filter((s) => s.id === rule.id)) {
        if (score.metric === "interview") {
          if (score.status === "working") interviews.push({ rule, score });
          continue;
        }
        if (score.status === "working") working.push({ rule, score });
        if (score.status === "not_working") paused.push({ rule, score });
      }
    }
    const fromOutcomes = accepted.filter((r) => r.tier !== "notes");
    const fromNotes = accepted.filter((r) => r.tier === "notes");
    const md: string[] = [];
    const items: string[] = [];
    const ev = (w: ScoredBaseline) => evidenceText(w.score, w.rule.target);
    if (fromOutcomes.length) {
      md.push("## Learned from my outcomes", "");
      md.push(...groupLines(fromOutcomes, (r) => r.family, (r) => `- ${r.text} (${TIER_TEXT[r.tier]}. ${r.evidence})`));
      items.push(...fromOutcomes.map((r) => item(`rule:${r.key}`, `learned "${r.text}"${r.family ? ` for ${r.family}` : ""}`, `${TIER_TEXT[r.tier]}. ${r.evidence}`)));
    }
    if (working.length) {
      md.push("## Baseline advice that works for me", "");
      md.push(...groupLines(working, (w) => w.score.family, (w) => `- ${w.rule.text} (${ev(w)})`));
      items.push(...working.map((w) => item(`work:${w.rule.id}:${fam(w.score.family)}`, `"${w.rule.text}" works ${forFam(w.score.family)}`, ev(w))));
    }
    if (interviews.length) {
      md.push("## What went with interviews for me", "");
      md.push(...groupLines(interviews, (w) => w.score.family, (w) => `- ${w.rule.text} (${ev(w)})`));
      items.push(...interviews.map((w) => item(`int:${w.rule.id}:${fam(w.score.family)}`, `"${w.rule.text}" went with interviews ${forFam(w.score.family)}`, ev(w))));
    }
    if (paused.length) {
      md.push("## Baseline advice paused for me", "", "My outcomes don't support these. Don't prioritize them for these job types.", "");
      md.push(...groupLines(paused, (w) => w.score.family, (w) => `- ${w.rule.text} (${ev(w)})`));
      items.push(...paused.map((w) => item(`pause:${w.rule.id}:${fam(w.score.family)}`, `paused "${w.rule.text}" ${forFam(w.score.family)}`, ev(w))));
    }
    if (fromNotes.length) {
      md.push("## From my notes (not yet backed by outcome counts)", "");
      md.push(...groupLines(fromNotes, (r) => r.family, (r) => `- ${r.text}`));
      items.push(...fromNotes.map((r) => item(`rule:${r.key}`, `"${r.text}" from your notes${r.family ? ` for ${r.family}` : ""}`, r.evidence)));
    }
    const learnedMd = md.join("\n").trim();
    return { id, name: SKILLS[id].name, accepted, proposed, working, paused, interviews, learnedMd, signature: learnedMd ? fnv1a(learnedMd).toString(36) : "baseline", items };
  });
}

/**
 * What changed between two versions of one skill, in plain words with the
 * evidence: "Added learned "Lead with SQL modeling" for Analytics engineering,
 * based on Early signal. 4 of 5 ...", "Updated ...", "Removed ...".
 */
export function diffItems(before: string[], after: string[]): string[] {
  const parse = (x: string) => {
    const [key, label, evidence] = x.split(SEP);
    return { key, label: label ?? key, evidence: evidence ?? "" };
  };
  const prev = new Map(before.map((x) => [parse(x).key, parse(x)]));
  const next = new Map(after.map((x) => [parse(x).key, parse(x)]));
  const out: string[] = [];
  for (const [k, n] of next) {
    const p = prev.get(k);
    if (!p) out.push(`Added ${n.label}${n.evidence ? `, based on ${n.evidence}` : ""}`);
    else if (p.evidence !== n.evidence) out.push(`Updated ${n.label}: now ${n.evidence}`);
  }
  for (const [k, p] of prev) if (!next.has(k)) out.push(`Removed ${p.label}`);
  return out;
}

/** Readable form of a stored item (for listing what a version contains). */
export function itemText(x: string): string {
  const [, label, evidence] = x.split(SEP);
  return label ? `${label}${evidence ? ` (${evidence})` : ""}` : x;
}

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function frontmatterField(md: string, field: string): string {
  const m = md.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : "";
}

/** The personal SKILL.md: frontmatter, house rules, the learned part, then the baseline unchanged. */
export function personalSkillMarkdown(p: PersonalSkill, baselineMd: string, version: number, date: string): string {
  const desc = frontmatterField(baselineMd, "description").replace(/^["']|["']$/g, "");
  return [
    "---",
    `name: ${p.id}-personal`,
    `description: ${desc}. Personalized from my own job-search outcomes (version ${version}, ${date}).`,
    "---",
    "",
    `# ${p.name} (personal, version ${version})`,
    "",
    "Built on the baseline skill at the end of this file (ResumeSkills by Param Choudhary, MIT License). The sections before the baseline come from my own applications and outcomes.",
    "",
    "## House rules",
    "",
    ...HOUSE_RULES.map((h) => `- ${h}`),
    "",
    p.learnedMd || "_Nothing learned yet. This skill behaves exactly like the baseline until my outcomes say otherwise._",
    "",
    "---",
    "",
    "# Baseline skill",
    "",
    stripFrontmatter(baselineMd),
    "",
  ].join("\n");
}

export interface ContextOptions {
  use: SkillUse;
  family: string | null;
  rules: PlaybookRule[];
  scores: RuleScore[];
  profile?: string[];
  chains?: string[];
  versions?: Record<string, number>;
  seed: number;
  /** Probability cap for holding a learned rule back to keep testing it. */
  exploreCap?: number;
}

/**
 * The skill context for one AI request. Accepted learned rules for the
 * skills this action uses and this job type are included, except a few held
 * back by Thompson sampling: when a draw for "without the rule" beats the
 * draw for "with it", the rule sits out this time (at most `exploreCap` of
 * the time), so its score keeps getting tested.
 */
export function skillContext(o: ContextOptions): SkillContext {
  const skills = new Set<SkillId>(SKILLS_FOR[o.use]);
  const rng = mulberry32(o.seed);
  const cap = o.exploreCap ?? 0.2;
  const learned: LearnedRuleRef[] = [];
  const explore: string[] = [];
  for (const r of o.rules) {
    if (r.status !== "accepted" || !r.current) continue;
    const skill = ruleSkill(r);
    if (!skills.has(skill) || (r.family !== null && r.family !== o.family)) continue;
    const id = learnedId(r.key);
    const sc = scoreFor(o.scores, id, o.family, "response");
    if (sc && sc.tier !== "strong" && rng() < cap) {
      const w = betaDraw(1 + sc.with.s, 1 + sc.with.n - sc.with.s, rng);
      const wo = betaDraw(1 + sc.without.s, 1 + sc.without.n - sc.without.s, rng);
      if (wo > w) {
        explore.push(id);
        continue;
      }
    }
    learned.push({ id, skill, text: r.text, evidence: r.evidence, tier: r.tier, origin: r.origin ?? "outcomes" });
  }
  const working: SkillContext["working"] = [];
  const paused: SkillContext["paused"] = [];
  for (const rule of BASELINE_RULES.filter((r) => skills.has(r.skill) && r.check)) {
    const sc = scoreFor(o.scores, rule.id, o.family);
    if (!sc) continue;
    if (sc.status === "working") working.push({ id: rule.id, evidence: evidenceText(sc, rule.target) });
    if (sc.status === "not_working") paused.push({ id: rule.id, evidence: evidenceText(sc, rule.target) });
  }
  return {
    family: o.family,
    learned: learned.slice(0, 30),
    working: working.slice(0, 20),
    paused: paused.slice(0, 20),
    explore: explore.slice(0, 10),
    profile: (o.profile ?? []).slice(0, 8),
    chains: (o.chains ?? []).slice(0, 5),
    versions: o.versions ?? {},
  };
}

/** Learned-rule ids to score, with the target each is judged on. */
export function learnedTargets(rules: PlaybookRule[]): { id: string; target: ReturnType<typeof targetOf> }[] {
  return rules.filter((r) => r.status === "accepted").map((r) => ({ id: learnedId(r.key), target: targetOf(r) }));
}

export function baselineText(id: string): string {
  return RULE_BY_ID.get(id)?.text ?? id;
}

/** A manifest for suggestions computed in the browser (no AI call), so they can show what they used. */
export function localManifest(action: string, use: SkillUse, ctx: SkillContext): import("./context").ContextManifest {
  return {
    action,
    baselineOnly: false,
    family: ctx.family,
    skills: SKILLS_FOR[use].map((id) => ({ id, name: SKILLS[id].name, mode: "rules" as const, version: ctx.versions[id] ?? null })),
    house: HOUSE_RULES,
    learned: ctx.learned,
    working: ctx.working.map((r) => ({ id: r.id, text: baselineText(r.id), evidence: r.evidence })),
    paused: ctx.paused.map((r) => ({ id: r.id, text: baselineText(r.id), evidence: r.evidence })),
    explore: ctx.explore,
    profile: ctx.profile,
    chains: ctx.chains,
    documents: [],
  };
}
