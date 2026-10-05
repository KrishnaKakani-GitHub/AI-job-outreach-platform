/**
 * What the client sends with an AI request so the server can load the right
 * skills, and what the server sends back so the user can see exactly what
 * the model was given ("What the AI saw").
 *
 * Only rule text, computed evidence strings and job-type facts travel here,
 * never contact details. Resume and job text travel in their own fields.
 */
import { z } from "zod";
import { SKILL_IDS } from "./catalog";

export const RULE_ORIGINS = ["outcomes", "job_type", "outreach", "notes"] as const;
export type RuleOrigin = (typeof RULE_ORIGINS)[number];

export const LEARNED_TIERS = ["notes", "early", "pattern", "strong"] as const;

export const LearnedRuleRef = z.object({
  id: z.string().max(220),
  skill: z.enum(SKILL_IDS),
  text: z.string().max(300),
  evidence: z.string().max(400),
  tier: z.enum(LEARNED_TIERS),
  origin: z.enum(RULE_ORIGINS),
});
export type LearnedRuleRef = z.infer<typeof LearnedRuleRef>;

export const ScoredRef = z.object({ id: z.string().max(220), evidence: z.string().max(400) });

export const SkillContext = z.object({
  /** Job type of this application (display label). */
  family: z.string().max(80).nullable(),
  /** Accepted learned rules for these skills and this job type. */
  learned: z.array(LearnedRuleRef).max(30).default([]),
  /** Baseline rules your outcomes support for this job type. */
  working: z.array(ScoredRef).max(20).default([]),
  /** Baseline rules your outcomes don't support for this job type. */
  paused: z.array(ScoredRef).max(20).default([]),
  /** Learned rules held back this time so they keep getting tested. */
  explore: z.array(z.string().max(220)).max(10).default([]),
  /** Job-type facts computed from your outcomes. */
  profile: z.array(z.string().max(400)).max(8).default([]),
  /** Outreach paths that ended in a response, as plain steps. */
  chains: z.array(z.string().max(300)).max(5).default([]),
  /** Personal version number of each skill used. */
  versions: z.record(z.string(), z.number().int().min(0)).default({}),
});
export type SkillContext = z.infer<typeof SkillContext>;

export const ContextManifest = z.object({
  action: z.string(),
  baselineOnly: z.boolean(),
  family: z.string().nullable(),
  skills: z.array(z.object({ id: z.enum(SKILL_IDS), name: z.string(), mode: z.enum(["full", "rules"]), version: z.number().nullable() })),
  house: z.array(z.string()),
  learned: z.array(LearnedRuleRef),
  working: z.array(z.object({ id: z.string(), text: z.string(), evidence: z.string() })),
  paused: z.array(z.object({ id: z.string(), text: z.string(), evidence: z.string() })),
  explore: z.array(z.string()),
  profile: z.array(z.string()),
  chains: z.array(z.string()),
  /** Documents included, by label and length only. */
  documents: z.array(z.object({ label: z.string(), chars: z.number() })),
});
export type ContextManifest = z.infer<typeof ContextManifest>;

export const TIER_TEXT: Record<(typeof LEARNED_TIERS)[number], string> = {
  notes: "From your notes",
  early: "Early signal",
  pattern: "Pattern",
  strong: "Strong pattern",
};
