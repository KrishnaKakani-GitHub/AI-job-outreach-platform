/**
 * Loads the baseline skills from skills/baseline (shipped with the server
 * bundle via outputFileTracingIncludes) and composes the skill part of a
 * prompt: the primary skill in full, supporting skills as their condensed
 * advice, the house rules, then the user's personal layer.
 *
 * compose() returns the prompt text and a manifest built from the same
 * inputs, so "What the AI saw" can never drift from what was sent.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BASELINE_RULES, SKILL_IDS, SKILLS, SKILLS_FOR, type SkillId, type SkillUse } from "@/lib/skills/catalog";
import { TIER_TEXT, type ContextManifest, type SkillContext } from "@/lib/skills/context";
import { baselineText, HOUSE_RULES } from "@/lib/skills/personal";
import { errorMessage, log } from "./log";

const cache = new Map<SkillId, string>();

export function skillPath(id: SkillId): string {
  return path.join(process.cwd(), "skills", "baseline", id, "SKILL.md");
}

export async function baselineMarkdown(id: SkillId): Promise<string> {
  if (!SKILL_IDS.includes(id)) throw new Error(`unknown skill ${id}`);
  const hit = cache.get(id);
  if (hit) return hit;
  const md = await readFile(skillPath(id), "utf8");
  cache.set(id, md);
  return md;
}

function body(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export interface Composed {
  /** Baseline skill text: stable across users, sent as the cached prefix. */
  prefix: string;
  /** House rules and the personal layer. */
  personal: string;
  manifest: ContextManifest;
}

export async function compose(
  action: string,
  use: SkillUse,
  ctx: SkillContext | null,
  opts: { baselineOnly?: boolean; documents?: { label: string; chars: number }[] } = {},
): Promise<Composed> {
  const ids = SKILLS_FOR[use];
  const [primary, ...supporting] = ids;
  let primaryMd = "";
  try {
    primaryMd = body(await baselineMarkdown(primary));
  } catch (e) {
    // The condensed rules still go out; the manifest says the full text didn't.
    log("warn", "skills.load_failed", { skill: primary, error: errorMessage(e) });
  }
  const prefix = [
    primaryMd ? `<skill name="${primary}" source="baseline">\n${primaryMd}\n</skill>` : "",
    supporting.length
      ? `Supporting skills (condensed baseline advice):\n${supporting
          .flatMap((s) => BASELINE_RULES.filter((r) => r.skill === s).map((r) => `- [${s}] ${r.text}`))
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const baselineOnly = Boolean(opts.baselineOnly) || !ctx;
  const c: SkillContext = ctx ?? { family: null, learned: [], working: [], paused: [], explore: [], profile: [], chains: [], versions: {} };
  const lines: string[] = [`House rules (these override every skill):\n${HOUSE_RULES.map((h) => `- ${h}`).join("\n")}`];
  if (!baselineOnly) {
    const p: string[] = [];
    if (c.family) p.push(`Job type of this application: ${c.family}.`);
    if (c.learned.length) p.push(`Learned rules (accepted by the user; follow them where true):\n${c.learned.map((r) => `- [${r.id}] ${r.text} (${TIER_TEXT[r.tier]}. ${r.evidence})`).join("\n")}`);
    if (c.working.length) p.push(`Baseline advice this user's outcomes support (prioritize):\n${c.working.map((r) => `- ${baselineText(r.id)} (${r.evidence})`).join("\n")}`);
    if (c.paused.length) p.push(`Baseline advice this user's outcomes don't support (don't prioritize):\n${c.paused.map((r) => `- ${baselineText(r.id)} (${r.evidence})`).join("\n")}`);
    if (c.profile.length) p.push(`Facts about this job type from the user's own outcomes (computed by code):\n${c.profile.map((f) => `- ${f}`).join("\n")}`);
    if (c.chains.length) p.push(`Outreach paths that ended in a response:\n${c.chains.map((f) => `- ${f}`).join("\n")}`);
    if (p.length) lines.push(`Personal layer, learned from this user's own applications. Where it conflicts with the baseline skill, follow it:\n${p.join("\n\n")}`);
  }

  const manifest: ContextManifest = {
    action,
    baselineOnly,
    family: c.family,
    skills: ids.map((id, i) => ({ id, name: SKILLS[id].name, mode: i === 0 && primaryMd ? "full" : "rules", version: baselineOnly ? null : (c.versions[id] ?? null) })),
    house: HOUSE_RULES,
    learned: baselineOnly ? [] : c.learned,
    working: baselineOnly ? [] : c.working.map((r) => ({ id: r.id, text: baselineText(r.id), evidence: r.evidence })),
    paused: baselineOnly ? [] : c.paused.map((r) => ({ id: r.id, text: baselineText(r.id), evidence: r.evidence })),
    explore: baselineOnly ? [] : c.explore,
    profile: baselineOnly ? [] : c.profile,
    chains: baselineOnly ? [] : c.chains,
    documents: opts.documents ?? [],
  };
  return { prefix, personal: lines.join("\n\n"), manifest };
}
