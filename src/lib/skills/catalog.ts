/**
 * The ten baseline skills. Their full instructions live, unchanged, in
 * skills/baseline/<id>/SKILL.md (Param Choudhary's ResumeSkills, MIT). This
 * file adds what the instructions alone can't give: a code check for each
 * piece of advice that can be checked, so the outcome data can score it.
 * Advice without a check still reaches the model through the skill text,
 * it just can't be scored.
 */
import type { Application, Channel, FitReport, Stage } from "../schemas";
import { parseCv, type ParsedCv } from "../resume";
import { keywords } from "../text";

export const SKILL_IDS = [
  "job-description-analyzer",
  "resume-tailor",
  "resume-bullet-writer",
  "resume-quantifier",
  "resume-ats-optimizer",
  "tech-resume-optimizer",
  "cold-email-writer",
  "cover-letter-generator",
  "resume-version-manager",
  "interview-prep-generator",
] as const;
export type SkillId = (typeof SKILL_IDS)[number];

export type SkillUse = "fit" | "tailor" | "draft" | "craft" | "interview";

export interface SkillMeta {
  id: SkillId;
  name: string;
  /** What it does inside this app, in one line. */
  does: string;
  /** Where the app sends it to the model. The first use is where it's the primary skill. */
  uses: SkillUse[];
}

export const SKILLS: Record<SkillId, SkillMeta> = {
  "job-description-analyzer": { id: "job-description-analyzer", name: "Job description analyzer", does: "Separates must-haves from nice-to-haves, pulls out keywords and flags red flags.", uses: ["fit", "craft", "tailor"] },
  "resume-tailor": { id: "resume-tailor", name: "Resume tailor", does: "Reorders sections and bullets so the most relevant come first and matches the summary to the job.", uses: ["tailor"] },
  "resume-bullet-writer": { id: "resume-bullet-writer", name: "Bullet writer", does: "Rewrites bullets as accomplished X, measured by Y, by doing Z, with strong action verbs.", uses: ["tailor"] },
  "resume-quantifier": { id: "resume-quantifier", name: "Quantifier", does: "Finds bullets that could carry a number and leaves [add metric] instead of inventing one.", uses: ["tailor"] },
  "resume-ats-optimizer": { id: "resume-ats-optimizer", name: "ATS optimizer", does: "Checks keyword coverage, standard headings and formatting screening software can read.", uses: ["tailor", "craft"] },
  "tech-resume-optimizer": { id: "tech-resume-optimizer", name: "Tech resume optimizer", does: "Section order for engineering, product and data roles; projects and links early in a career.", uses: ["tailor"] },
  "cold-email-writer": { id: "cold-email-writer", name: "Cold email writer", does: "Opens with a specific detail, stays short and avoids filler closings.", uses: ["draft"] },
  "cover-letter-generator": { id: "cover-letter-generator", name: "Cover letter generator", does: "Talking points tied to what the job post emphasizes.", uses: ["tailor"] },
  "resume-version-manager": { id: "resume-version-manager", name: "Version manager", does: "One master resume; records which tailored version went to which application.", uses: ["tailor"] },
  "interview-prep-generator": { id: "interview-prep-generator", name: "Interview prep generator", does: "Likely questions from the job post and STAR outlines from your own resume lines.", uses: ["interview"] },
};

/** Which skills each action sends to the model. The first is sent in full; the rest as rule lists. */
export const SKILLS_FOR: Record<SkillUse, SkillId[]> = {
  fit: ["job-description-analyzer"],
  craft: ["job-description-analyzer", "resume-ats-optimizer"],
  tailor: ["resume-tailor", "resume-bullet-writer", "resume-quantifier", "resume-ats-optimizer", "tech-resume-optimizer", "job-description-analyzer", "cover-letter-generator", "resume-version-manager"],
  draft: ["cold-email-writer"],
  interview: ["interview-prep-generator"],
};

export type RuleTarget = "cv" | "message" | "targeting" | "interview";

export interface CheckInput {
  cv?: ParsedCv | null;
  cvText?: string | null;
  jobText?: string;
  fit?: FitReport | null;
  message?: { text: string; channel: Channel; stage: Stage; hasClaim: boolean } | null;
  app?: Pick<Application, "cv" | "prepAt"> | null;
}

export interface BaselineRule {
  /** `<skill>/<slug>`; stable, used as the key in traces and scores. */
  id: string;
  skill: SkillId;
  target: RuleTarget;
  /** The advice, condensed from the skill. */
  text: string;
  /** True if the sent material followed it, false if not, null if it can't be judged. */
  check: ((x: CheckInput) => boolean | null) | null;
}

const VERBS = new Set(
  (
    "achieved analyzed architected automated built championed collaborated created cut decreased defined delivered deployed designed developed " +
    "directed drove engineered established evaluated expanded generated grew identified implemented improved increased launched led maintained " +
    "managed mentored migrated modeled optimized orchestrated owned partnered piloted prototyped published raised reduced refactored resolved " +
    "scaled shipped simplified spearheaded streamlined tested trained transformed validated wrote ran coordinated investigated measured " +
    "integrated instrumented forecasted visualized standardized secured negotiated organized presented researched audited documented"
  ).split(" "),
);
const DUTY = /\b(responsible for|helped( with)?|assisted( with)?|worked on|duties included|tasked with)\b/i;
const FILLER_CLOSE = /\b(look forward to hearing|please find attached|i would love the opportunity|excited to potentially)\b/i;

const bulletsOf = (x: CheckInput) => x.cv?.bullets ?? [];
const share = (n: number, d: number) => (d ? n / d : 0);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
function requirementTerms(x: CheckInput): string[] {
  const src = x.fit?.ratings.map((r) => r.requirement).join(" ") ?? x.jobText ?? "";
  return [...new Set(keywords(src))];
}

export const BASELINE_RULES: BaselineRule[] = [
  // Job description analyzer
  { id: "job-description-analyzer/target-70-90", skill: "job-description-analyzer", target: "targeting", text: "Apply where you match roughly 70 to 90 percent of the requirements.", check: (x) => (x.fit ? x.fit.score >= 70 : null) },
  { id: "job-description-analyzer/must-haves", skill: "job-description-analyzer", target: "targeting", text: "Make sure every must-have requirement has evidence on your resume before applying.", check: (x) => (x.fit ? !x.fit.ratings.some((r) => r.weight >= 1.5 && r.evidence === "missing") && x.fit.ratings.filter((r) => r.evidence === "missing").length <= 1 : null) },
  // Resume tailor
  { id: "resume-tailor/relevant-first", skill: "resume-tailor", target: "cv", text: "Lead each section with the bullets most relevant to this job.", check: (x) => {
      const b = bulletsOf(x);
      const terms = new Set(requirementTerms(x));
      if (b.length < 3 || !terms.size) return null;
      return b.slice(0, 3).some((l) => keywords(l.text).some((k) => terms.has(k)));
    } },
  { id: "resume-tailor/summary-match", skill: "resume-tailor", target: "cv", text: "Open with a summary that mirrors the role's main requirements.", check: (x) => {
      if (!x.cv) return null;
      const s = x.cv.lines.filter((l) => l.section === "summary" && !l.heading).map((l) => l.text).join(" ");
      if (!s) return false;
      const terms = new Set(requirementTerms(x));
      return keywords(s).some((k) => terms.has(k));
    } },
  // Bullet writer
  { id: "resume-bullet-writer/action-verbs", skill: "resume-bullet-writer", target: "cv", text: "Start every bullet with a strong action verb.", check: (x) => {
      const b = bulletsOf(x);
      return b.length ? share(b.filter((l) => VERBS.has(l.text.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "")).length, b.length) >= 0.8 : null;
    } },
  { id: "resume-bullet-writer/no-duties", skill: "resume-bullet-writer", target: "cv", text: "Describe achievements, not duties (no \"responsible for\" or \"helped with\").", check: (x) => (bulletsOf(x).length ? !bulletsOf(x).some((l) => DUTY.test(l.text)) : null) },
  // Quantifier
  { id: "resume-quantifier/numbers", skill: "resume-quantifier", target: "cv", text: "Put a real number (scale, time, percent, money) in at least half of your bullets.", check: (x) => (bulletsOf(x).length ? share(bulletsOf(x).filter((l) => /\d/.test(l.text) && !/\[add metric\]/i.test(l.text)).length, bulletsOf(x).length) >= 0.5 : null) },
  // ATS optimizer
  { id: "resume-ats-optimizer/headings", skill: "resume-ats-optimizer", target: "cv", text: "Use standard section headings: Experience, Education, Skills.", check: (x) => (x.cv ? ["experience", "education", "skills"].every((h) => x.cv!.headings.includes(h)) : null) },
  { id: "resume-ats-optimizer/keywords", skill: "resume-ats-optimizer", target: "cv", text: "Cover at least 60 percent of the job post's requirement keywords, only where true.", check: (x) => {
      const terms = requirementTerms(x);
      if (!x.cvText || terms.length < 3) return null;
      const mine = new Set(keywords(x.cvText));
      return share(terms.filter((t) => mine.has(t)).length, terms.length) >= 0.6;
    } },
  { id: "resume-ats-optimizer/plain-format", skill: "resume-ats-optimizer", target: "cv", text: "Keep formatting plain: no tables, columns, or text in graphics.", check: (x) => (x.cvText ? !/[|│┃\t]/.test(x.cvText) : null) },
  // Tech resume optimizer
  { id: "tech-resume-optimizer/skills-section", skill: "tech-resume-optimizer", target: "cv", text: "Group technical skills in their own section.", check: (x) => (x.cv ? x.cv.headings.includes("skills") : null) },
  { id: "tech-resume-optimizer/projects-links", skill: "tech-resume-optimizer", target: "cv", text: "Early in a career, show projects with a GitHub or portfolio link.", check: (x) => (x.cvText ? /github\.com|gitlab\.com|https?:\/\//i.test(x.cvText) && (x.cv?.headings.includes("projects") ?? false) : null) },
  // Cover letter generator (advice only; the app doesn't send letters)
  { id: "cover-letter-generator/talking-points", skill: "cover-letter-generator", target: "cv", text: "Tie two or three talking points to what the post emphasizes most.", check: null },
  // Version manager
  { id: "resume-version-manager/tailored", skill: "resume-version-manager", target: "cv", text: "Tailor a version from your master resume for each application, and record which one you sent.", check: (x) => (x.app ? Boolean(x.app.cv?.tailored) : null) },
  // Cold email writer
  { id: "cold-email-writer/specific-hook", skill: "cold-email-writer", target: "message", text: "Open with something specific to them or the company, not general praise.", check: (x) => (x.message ? x.message.hasClaim : null) },
  { id: "cold-email-writer/length", skill: "cold-email-writer", target: "message", text: "Keep emails to 150 to 300 words; keep connection notes short.", check: (x) => {
      if (!x.message) return null;
      if (x.message.channel === "email") return words(x.message.text) >= 150 && words(x.message.text) <= 300;
      return x.message.text.length <= 300;
    } },
  { id: "cold-email-writer/no-filler-close", skill: "cold-email-writer", target: "message", text: "Close with one clear ask, not \"I look forward to hearing from you\".", check: (x) => (x.message ? !FILLER_CLOSE.test(x.message.text) : null) },
  // Interview prep generator
  { id: "interview-prep-generator/star-stories", skill: "interview-prep-generator", target: "interview", text: "Prepare a STAR story for each must-have requirement before the interview.", check: (x) => (x.app ? x.app.prepAt !== null : null) },
  { id: "interview-prep-generator/questions-for-them", skill: "interview-prep-generator", target: "interview", text: "Bring two or three questions about the team's goals and how success is measured.", check: null },
];

export const RULE_BY_ID = new Map(BASELINE_RULES.map((r) => [r.id, r]));

/**
 * Signed trace of the baseline rules of one target: "id" when the material
 * followed the rule, "!id" when it didn't. Rules that can't be judged are left
 * out, so they never count as evidence either way.
 */
export function traceRules(target: RuleTarget, input: CheckInput): string[] {
  const x = input.cvText && !input.cv ? { ...input, cv: parseCv(input.cvText) } : input;
  const out: string[] = [];
  for (const r of BASELINE_RULES) {
    if (r.target !== target || !r.check) continue;
    const v = r.check(x);
    if (v !== null) out.push(v ? r.id : `!${r.id}`);
  }
  return out;
}

/** Whether a trace says the rule was followed (true), not followed (false), or unknown (null). */
export function followed(trace: readonly string[] | null | undefined, id: string): boolean | null {
  if (!trace) return null;
  if (trace.includes(id)) return true;
  if (trace.includes(`!${id}`)) return false;
  return null;
}
