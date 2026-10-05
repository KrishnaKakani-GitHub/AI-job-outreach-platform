/**
 * AI-backed services. Each one: (1) asks the model for structured output,
 * (2) validates it, (3) recomputes anything numeric in code, and (4) falls
 * back to the deterministic engine if AI is unavailable or fails validation.
 */
import { z } from "zod";
import { extractJobMeta, extractRecipientMeta } from "@/lib/classify";
import { buildFitReport, rateRequirementsByRules } from "@/lib/fit";
import { detectSharedGround } from "@/lib/shared";
import { charLimit, fitToLimit, rulesDraft, STAGE_PARTS, type DraftContext } from "@/lib/draft";
import { validateDraft, type Issue } from "@/lib/validators";
import type { StrategyFacts } from "@/lib/strategy";
import {
  AnatomyPart,
  Channel,
  Draft,
  FitReport,
  JobMeta,
  Opener,
  RecipientType,
  RequirementRating,
  SimilarCompany,
  Stage,
  type SharedGround,
} from "@/lib/schemas";
import { AiUnavailableError, aiEnabled, asData, callTool, DATA_RULE } from "./ai";
import { errorMessage, log } from "./log";
import { compose } from "./skills";
import { ContextManifest, SkillContext } from "@/lib/skills/context";
import { SKILL_IDS, SKILLS, BASELINE_RULES } from "@/lib/skills/catalog";
import { applyPlan, rulesPlan, TailorPlan, validatePlan, type Tailored } from "@/lib/tailor";
import { parseCv } from "@/lib/resume";
import { InterviewPrep, rulesPrep, validatePrep } from "@/lib/interview";
import { fnv1a } from "@/lib/ab";

export const AnalyzeInput = z.object({
  jobText: z.string().min(40).max(30000),
  resume: z.string().max(40000).default(""),
  background: z.string().max(2000).default(""),
});

export async function analyzeFit(input: z.infer<typeof AnalyzeInput>): Promise<FitReport> {
  const me = `${input.background}\n${input.resume}`.trim();
  const rulesMeta = extractJobMeta(input.jobText);
  if (aiEnabled() && me.length > 40) {
    try {
      const out = await callTool({
        action: "analyze_fit",
        tool: "report_fit",
        description: "Report job metadata and rate the candidate's evidence for each major requirement.",
        schema: z.object({ meta: JobMeta, ratings: z.array(RequirementRating).min(1).max(12) }),
        system: [
          "You assess how well a candidate's resume evidences each requirement in a job post.",
          "List the 5 to 10 most important requirements, in the post's own words, shortened.",
          "evidence: strong = a resume line clearly demonstrates it; partial = related but indirect; missing = nothing supports it.",
          "resumeQuote MUST be copied verbatim from the resume (one line or a contiguous part of one) or null. Never paraphrase or invent.",
          "gapTag is null for strong; otherwise pick the closest tag. weight: 1.5 for must-haves, 0.75 for nice-to-haves, else 1.",
          "Do not output a score; it is computed separately.",
          DATA_RULE,
        ].join("\n"),
        user: `${asData("job_post", input.jobText)}\n\n${asData("resume", me)}`,
      });
      return buildFitReport(out.meta, out.ratings, me, "ai");
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) log("warn", "analyze.fallback", { error: errorMessage(e) });
    }
  }
  return buildFitReport(rulesMeta, rateRequirementsByRules(input.jobText, me), me, "rules");
}

export const DraftInput = z.object({
  recipientText: z.string().min(20).max(20000),
  jobText: z.string().max(30000).default(""),
  background: z.string().max(2000).default(""),
  resume: z.string().max(40000).default(""),
  myName: z.string().max(80).default(""),
  stage: Stage,
  channel: Channel,
  recipientType: RecipientType.nullable().default(null),
  premium: z.boolean().default(false),
  fit: FitReport.nullable().default(null),
  instruction: z.string().max(300).nullable().default(null),
  regeneratePart: AnatomyPart.nullable().default(null),
  current: Draft.nullable().default(null),
  /** Learned from the user's own outcomes on the client (lib/learn.ts). Only shapes variant B. */
  guidance: z
    .object({
      opener: Opener,
      maxChars: z.number().int().min(80).max(600).nullable().default(null),
      rules: z.array(z.string().max(300)).max(8).default([]),
    })
    .nullable()
    .default(null),
  /** Personal skill layer for variant B. Null = baseline skill only. */
  skills: SkillContext.nullable().default(null),
});

export interface DraftResult {
  draft: Draft;
  shared: SharedGround[];
  recipient: { firstName: string | null; title: string | null; recipientType: z.infer<typeof RecipientType>; reason: string; suggested: boolean };
  meta: { role: string; company: string | null };
  limit: number | null;
  issues: Issue[];
  source: "ai" | "rules";
  /** Exactly what the model was given; null when the rules engine wrote the draft. */
  context: ContextManifest | null;
}

export async function draftMessage(input: z.infer<typeof DraftInput>): Promise<DraftResult> {
  const me = `${input.background}\n${input.resume}`.trim();
  const shared = detectSharedGround(me, input.recipientText);
  const rMeta = extractRecipientMeta(input.recipientText, shared.some((s) => s.kind === "school"));
  const recipientType = input.recipientType ?? rMeta.recipientType;
  const meta = input.fit?.meta ?? (input.jobText ? extractJobMeta(input.jobText) : { role: "the open role", company: null });
  const limit = charLimit(input.stage, input.channel, input.premium);
  const src = { recipient: input.recipientText, me, job: input.jobText };
  const ctx: DraftContext = {
    stage: input.stage,
    channel: input.channel,
    recipientType,
    recipientFirstName: rMeta.firstName,
    myName: input.myName,
    role: meta.role,
    company: meta.company,
    shared,
    fit: input.fit,
    premium: input.premium,
  };
  const recipient = { ...rMeta, recipientType, suggested: input.recipientType === null };
  const base = { shared, recipient, meta: { role: meta.role, company: meta.company }, limit };

  if (aiEnabled()) {
    const skills = await compose("draft_message", "draft", input.skills, {
      documents: [
        { label: "Their profile", chars: input.recipientText.length },
        { label: "Your resume and background", chars: me.length },
        ...(input.jobText ? [{ label: "Job post", chars: input.jobText.length }] : []),
      ],
    });
    let feedback: Issue[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const draft = await aiDraft(input, ctx, shared, src, limit, feedback, skills);
        const fitted = fitToLimit(draft, limit);
        const v = validateDraft(fitted, src, limit);
        if (v.ok) return { ...base, draft: fitted, issues: v.issues, source: "ai", context: skills.manifest };
        feedback = v.issues.filter((i) => i.severity === "error");
        log("info", "draft.rejected_by_validator", { attempt, errors: feedback.map((i) => i.kind) });
      } catch (e) {
        if (e instanceof AiUnavailableError) break;
        log("warn", "draft.ai_failed", { attempt, error: errorMessage(e) });
        break;
      }
    }
  }
  const draft = rulesDraft(input.guidance?.opener === "role_led" ? { ...ctx, shared: [] } : ctx);
  return { ...base, draft, issues: validateDraft(draft, src, limit).issues, source: "rules", context: null };
}

async function aiDraft(
  input: z.infer<typeof DraftInput>,
  ctx: DraftContext,
  shared: SharedGround[],
  src: { recipient: string; me: string; job: string },
  limit: number | null,
  feedback: Issue[],
  skills: Awaited<ReturnType<typeof compose>>,
): Promise<Draft> {
  const parts = STAGE_PARTS[ctx.stage];
  const strong = ctx.fit?.ratings.filter((r) => r.evidence === "strong" && r.resumeQuote).slice(0, 3) ?? [];
  const system = [
    "You write short, specific outreach messages for an early-career job seeker. Voice: formal, polite, warm, plain.",
    `Write exactly these anatomy parts, in order: ${parts.join(", ")}.`,
    "connection = the genuine shared ground or the reason for reaching out; background = why the sender fits, citing ONE strong resume line; learn = what the sender wants to learn; ask = one concrete, low-effort ask.",
    "GROUNDING RULES (enforced by code):",
    "- Every personalized fact (shared school, employer, location, the recipient's work, the sender's accomplishment, a company detail) must be listed in that segment's claims.",
    "- claim.text must appear verbatim in the segment text; claim.quote must be copied verbatim from the cited source (recipient, me, or job).",
    "- Never mention any name, school, company, number, or event that does not appear in the sources.",
    "- If there is no real shared ground, do not pretend there is; lead with the role instead.",
    "- Include a company detail only if it connects to the sender's own experience.",
    "STYLE: no em dashes; at most one exclamation mark; no filler like 'I hope this finds you well' or 'passionate'.",
    limit ? `The full rendered message (greeting + body + signoff) MUST be at most ${limit} characters. Use a one-line signoff like "- FirstName".` : "Keep it under 120 words.",
    input.channel === "email" ? "Include a specific subject line." : "subject must be null.",
    "The cold-email-writer skill above is your baseline style guide. The grounding rules and the length limit in this message override it.",
    skills.personal,
    DATA_RULE,
  ].join("\n");
  const user = [
    `Stage: ${ctx.stage}. Channel: ${ctx.channel}. Recipient type: ${ctx.recipientType}. Role applied for: ${ctx.role}${ctx.company ? ` at ${ctx.company}` : ""}.`,
    `Sender name for signoff: ${ctx.myName || "(not given; sign off with no name)"}. Recipient first name: ${ctx.recipientFirstName ?? "(unknown; use 'Hi there,')"}.`,
    shared.length ? `Detected shared ground (verified by code): ${shared.map((s) => `${s.label} [${s.kind}]`).join("; ")}.` : "Detected shared ground: none.",
    strong.length ? `Strongest verified fit evidence: ${strong.map((r) => `"${r.requirement}" ← "${r.resumeQuote}"`).join(" | ")}` : "No verified strong fit evidence; keep the background general and claim-free.",
    guidanceText(input.guidance, shared),
    input.instruction ? `User instruction for this revision: ${input.instruction}` : "",
    input.regeneratePart && input.current ? `Rewrite ONLY the "${input.regeneratePart}" segment; copy all other segments exactly from this current draft: ${JSON.stringify(input.current)}` : "",
    feedback.length ? `Your previous draft failed these checks; fix them: ${feedback.map((f) => f.message).join(" ")}` : "",
    asData("recipient", src.recipient),
    asData("me", src.me),
    src.job ? asData("job", src.job) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return callTool({ action: "draft_message", tool: "write_draft", description: "Return the outreach draft as structured segments with grounded claims.", schema: Draft, system, user, maxTokens: 1500, cachedPrefix: skills.prefix });
}

const OPENER_INSTRUCTION: Record<z.infer<typeof Opener>, string> = {
  shared_school: "Open with the shared school.",
  shared_employer: "Open with the shared employer.",
  shared_field: "Open with the shared field of work.",
  shared_other: "Open with the shared ground detected above.",
  role_led: "Open with the role you applied for, not with shared ground.",
  template: "",
};

/** The user's learned preferences, phrased as soft instructions. Grounding rules still win. */
function guidanceText(g: z.infer<typeof DraftInput>["guidance"], shared: SharedGround[]): string {
  if (!g) return "";
  const lines: string[] = [];
  const needsShared = g.opener !== "role_led" && g.opener !== "template";
  if (!needsShared || shared.length) lines.push(OPENER_INSTRUCTION[g.opener]);
  if (g.maxChars) lines.push(`Keep the whole message under ${g.maxChars} characters.`);
  for (const r of g.rules) lines.push(`- ${r}`);
  return lines.filter(Boolean).length
    ? `Personal guidance learned from this sender's own outreach results (follow it unless it conflicts with the grounding rules):\n${lines.filter(Boolean).join("\n")}`
    : "";
}

// ---- Playbook wording ----

export const RewordInput = z.object({
  rules: z
    .array(z.object({ key: z.string().max(200), text: z.string().max(300), evidence: z.string().max(400) }))
    .min(1)
    .max(20),
});

/**
 * Let the model turn computed rules into crisp heuristics. Each rewrite must
 * keep the rule's meaning and may only use numbers present in its evidence;
 * anything else falls back to the code-written text.
 */
export async function rewordRules(input: z.infer<typeof RewordInput>): Promise<{ key: string; text: string; source: "ai" | "rules" }[]> {
  const rules = input.rules;
  const fallback = rules.map((r) => ({ key: r.key, text: r.text, source: "rules" as const }));
  if (!aiEnabled()) return fallback;
  try {
    const out = await callTool({
      action: "reword_playbook",
      tool: "write_rules",
      description: "Rewrite each job-search rule as one short, specific, actionable heuristic.",
      schema: z.object({ rules: z.array(z.object({ key: z.string(), text: z.string().max(220) })).max(20) }),
      system: [
        "You are a sharp career coach writing a personal playbook from a job seeker's own results.",
        "Rewrite each rule as ONE imperative sentence (max 25 words) that says exactly what to do next time.",
        "Keep the rule's meaning and scope (role family) exactly. Do not add advice the evidence doesn't support.",
        "Numbers are optional; if you use any, they must appear in that rule's evidence. Never invent statistics, companies, or names.",
        "No em dashes. Return every key you were given.",
        DATA_RULE,
      ].join("\n"),
      user: asData("rules", JSON.stringify(rules)),
      maxTokens: 1200,
    });
    const byKey = new Map(out.rules.map((r) => [r.key, r.text.trim()]));
    return rules.map((r) => {
      const t = byKey.get(r.key);
      const ok = t && t.length >= 12 && !/—/.test(t) && numbersAreGrounded(t, { evidence: r.evidence, text: r.text });
      if (t && !ok) log("info", "playbook.reword_rejected", { key: r.key });
      return ok ? { key: r.key, text: t!, source: "ai" as const } : { key: r.key, text: r.text, source: "rules" as const };
    });
  } catch (e) {
    log("warn", "playbook.fallback", { error: errorMessage(e) });
    return fallback;
  }
}

// ---- Strategy narrative ----

/** Every number in AI prose must already exist in the computed facts. */
export function numbersAreGrounded(text: string, facts: unknown): boolean {
  const allowed = new Set<string>();
  for (const n of JSON.stringify(facts).match(/\d+(\.\d+)?/g) ?? []) {
    const x = Number(n);
    allowed.add(String(x));
    if (x > 0 && x <= 1) allowed.add(String(Math.round(x * 100))); // rates shown as percentages
  }
  for (const n of text.match(/\d+(\.\d+)?/g) ?? []) {
    const v = String(Number(n));
    if (!allowed.has(v) && !allowed.has(String(Math.round(Number(n))))) return false;
  }
  return true;
}

export async function strategyNarrative(facts: StrategyFacts): Promise<{ summary: string; targetWhy: string[]; source: "ai" | "rules" }> {
  const rules = {
    summary: rulesSummary(facts),
    targetWhy: facts.targets.map((t) => (t.evidence ? `Your resume already shows "${t.evidence.resumeQuote}", which matches "${t.evidence.requirement}".` : "Strong average fit across these postings.")),
    source: "rules" as const,
  };
  if (!aiEnabled()) return rules;
  try {
    const out = await callTool({
      action: "strategy_narrative",
      tool: "write_strategy",
      description: "Explain the computed job-search facts as a short, direct debrief.",
      schema: z.object({ summary: z.string().max(900), targetWhy: z.array(z.string().max(280)).max(3) }),
      system: [
        "You are a direct, kind career mentor. Explain ONLY the facts provided (computed by code).",
        "Do not introduce any number that is not in the facts. Rejection reasons are hypotheses, never certainties; say 'likely' or 'may'.",
        "summary: 3 to 5 sentences on the clearest pattern and the single most useful change.",
        "targetWhy: one sentence per target explaining why the candidate fits, quoting the evidence resume line exactly when given.",
      ].join("\n"),
      user: asData("facts", JSON.stringify(facts)),
    });
    if (!numbersAreGrounded(out.summary + out.targetWhy.join(" "), facts)) {
      log("warn", "strategy.ungrounded_numbers");
      return rules;
    }
    return { ...out, source: "ai" };
  } catch (e) {
    log("warn", "strategy.fallback", { error: errorMessage(e) });
    return rules;
  }
}

function rulesSummary(f: StrategyFacts): string {
  const parts: string[] = [];
  if (f.stalls[0]) parts.push(`Most rejections happened ${f.stalls[0].label.toLowerCase()} (${f.stalls[0].count}).`);
  if (f.topGaps[0]) parts.push(`Your most frequent gap is ${f.topGaps[0].label.toLowerCase()}, flagged in ${f.topGaps[0].count} fit checks.`);
  if (f.targets[0]) parts.push(`Your strongest lane right now is ${f.targets[0].family} at ${f.targets[0].seniority} level.`);
  if (f.stalls[0]?.label.startsWith("No response")) parts.push("Since most applications stop before any response, the likely lever is the resume's first screen: summary, keywords, and visible domain fit.");
  return parts.join(" ") || "Log a few more applications and outcomes to see patterns.";
}

// ---- Similar companies after a final-round rejection ----

export const SimilarInput = z.object({ company: z.string().min(1).max(120), role: z.string().max(120), jobText: z.string().max(30000).default("") });

export async function similarCompanies(input: z.infer<typeof SimilarInput>): Promise<SimilarCompany[]> {
  const out = await callTool({
    action: "similar_companies",
    tool: "list_similar",
    description: "List companies similar to the given one for a candidate who reached its final round.",
    schema: z.object({ companies: z.array(SimilarCompany).min(1).max(6) }),
    system: [
      "Suggest 4 to 6 real companies that are close competitors or adjacent to the given company in product category, customer, and stage, and that plausibly hire for a similar role.",
      "'why' names the concrete similarity in one sentence. Do not claim they are currently hiring; the user will verify.",
      DATA_RULE,
    ].join("\n"),
    user: `Company: ${input.company}\nRole: ${input.role}\n${input.jobText ? asData("job_post", input.jobText.slice(0, 6000)) : ""}`,
    maxTokens: 800,
  });
  return out.companies;
}

// ---- Tailored CV ----

export const TailorInput = z.object({
  resume: z.string().min(80).max(40000),
  jobText: z.string().max(30000).default(""),
  fit: FitReport.nullable().default(null),
  role: z.string().max(200).default(""),
  company: z.string().max(200).nullable().default(null),
  skills: SkillContext.nullable().default(null),
  /** True for the comparison run: baseline skills only, no personal layer. */
  baselineOnly: z.boolean().default(false),
  /** Resume lines learned rules say to keep near the top (outreach into the CV). */
  boosts: z.array(z.string().max(400)).max(5).default([]),
});

export interface TailorResult extends Tailored {
  source: "ai" | "rules";
  context: ContextManifest | null;
}

/**
 * Tailor the resume to one job. The model proposes a plan citing rule ids;
 * validatePlan keeps only grounded changes; applyPlan renders the result.
 * Falls back to the rules plan (reordering only) if AI is off or fails.
 */
export async function tailorResume(input: z.infer<typeof TailorInput>): Promise<TailorResult> {
  const ctx = input.baselineOnly ? null : input.skills;
  const allowed = new Set([...BASELINE_RULES.map((r) => r.id), ...(ctx?.learned.map((r) => r.id) ?? [])]);
  const opts = { resume: input.resume, jobText: input.jobText, fit: input.fit, role: `${input.role} ${input.company ?? ""}`, allowedRules: allowed };
  const boosts = input.baselineOnly ? [] : input.boosts;
  const fallback = (): TailorResult => {
    const v = validatePlan(rulesPlan(input.resume, input.fit, input.jobText, boosts), opts);
    return { ...applyPlan(input.resume, v.plan, input.fit, input.jobText, v.rejected), source: "rules", context: null };
  };
  if (!aiEnabled()) return fallback();
  const skills = await compose("tailor_resume", "tailor", ctx, {
    baselineOnly: input.baselineOnly,
    documents: [
      { label: "Your resume", chars: input.resume.length },
      { label: "Job post", chars: input.jobText.length },
    ],
  });
  const cv = parseCv(input.resume);
  const numbered = cv.lines.map((l) => `${l.id}${l.heading ? " [heading]" : l.bullet ? " [bullet]" : ""} (${l.section || "top"}): ${l.text}`).join("\n");
  try {
    const plan = await callTool({
      action: "tailor_resume",
      tool: "tailor_plan",
      description: "Propose a tailored version of the resume for this job as a validated edit plan.",
      schema: TailorPlan,
      cachedPrefix: skills.prefix,
      system: [
        "You tailor an early-career candidate's resume to one job, using the resume-tailor skill above as the baseline method and the supporting skills as checks.",
        "Output a plan, not a new resume:",
        "- summary: 1 to 2 sentences matching the role, built only from facts in the resume. null to leave as is.",
        "- edits: rewrites of existing lines by lineId. Keep each line's facts; you may change verbs, order of clauses and wording. Every number must already be in that line. Where a number would help but is missing, add [add metric].",
        "- order: for each section, the bullet lineIds in the new order (same lines, every one of them).",
        "- talkingPoints: up to 3 cover-letter points, each with a quote copied verbatim from the resume.",
        "- ruleIds on each change and in applied: the ids of the rules you followed (baseline ids like resume-tailor/relevant-first, or learned ids in brackets below). Only cite ids that appear in this prompt.",
        "Never add a skill, tool or term the resume doesn't already mention, even if the job post asks for it. Code rejects any change that does.",
        boosts.length ? `Keep these lines near the top of their section (they led outreach that got responses): ${boosts.map((b) => `"${b}"`).join("; ")}` : "",
        skills.personal,
        DATA_RULE,
      ]
        .filter(Boolean)
        .join("\n"),
      user: [`Role: ${input.role}${input.company ? ` at ${input.company}` : ""}`, asData("resume_lines", numbered), asData("job_post", input.jobText.slice(0, 12000))].join("\n\n"),
      maxTokens: 2500,
    });
    const v = validatePlan(plan, opts);
    if (v.rejected.length) log("info", "tailor.rejected_by_validator", { count: v.rejected.length });
    return { ...applyPlan(input.resume, v.plan, input.fit, input.jobText, v.rejected), source: "ai", context: skills.manifest };
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) log("warn", "tailor.fallback", { error: errorMessage(e) });
    return fallback();
  }
}

// ---- Interview prep ----

export const InterviewInput = z.object({
  resume: z.string().max(40000).default(""),
  jobText: z.string().max(30000).default(""),
  fit: FitReport.nullable().default(null),
  role: z.string().max(200).default(""),
  skills: SkillContext.nullable().default(null),
});

export interface InterviewResult {
  prep: InterviewPrep;
  fixed: number;
  source: "ai" | "rules";
  context: ContextManifest | null;
}

export async function interviewPrep(input: z.infer<typeof InterviewInput>): Promise<InterviewResult> {
  const fallback = (): InterviewResult => ({ prep: rulesPrep(input.fit, input.jobText, input.resume), fixed: 0, source: "rules", context: null });
  if (!aiEnabled() || input.resume.length < 40) return fallback();
  const skills = await compose("interview_prep", "interview", input.skills, {
    documents: [
      { label: "Your resume", chars: input.resume.length },
      { label: "Job post", chars: input.jobText.length },
    ],
  });
  try {
    const out = await callTool({
      action: "interview_prep",
      tool: "write_prep",
      description: "Return likely interview questions with STAR outlines built from the candidate's resume.",
      schema: InterviewPrep,
      cachedPrefix: skills.prefix,
      system: [
        "Using the interview-prep-generator skill above, write 5 to 7 likely questions for this job, one per important requirement, plus 3 questions the candidate should ask.",
        "For each question: requirement = the post's requirement it tests; quote = one resume line copied verbatim that best answers it, or null.",
        "STAR: build situation, task, action and result only from the quoted line and the resume. Anything the resume doesn't say must be written as [fill in]. Never invent companies, numbers, or outcomes.",
        skills.personal,
        DATA_RULE,
      ].join("\n"),
      user: [`Role: ${input.role}`, asData("resume", input.resume), asData("job_post", input.jobText.slice(0, 12000))].join("\n\n"),
      maxTokens: 2500,
    });
    const v = validatePrep(out, input.resume, input.jobText);
    return { prep: v.prep, fixed: v.fixed, source: "ai", context: skills.manifest };
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) log("warn", "interview.fallback", { error: errorMessage(e) });
    return fallback();
  }
}

// ---- Rules from outcome notes ----

export const NotesInput = z.object({
  notes: z
    .array(
      z.object({
        appId: z.string().max(80),
        family: z.string().max(80),
        result: z.string().max(40),
        reason: z.string().max(60),
        reasonSource: z.string().max(40),
        notes: z.string().max(2000),
        learning: z.string().max(1000),
      }),
    )
    .min(1)
    .max(25),
  /** Rules already in the playbook, so the model doesn't repeat them. */
  existing: z.array(z.string().max(300)).max(40).default([]),
});

export interface NoteRule {
  key: string;
  skill: (typeof SKILL_IDS)[number];
  family: string | null;
  text: string;
  appIds: string[];
}

/**
 * Turn the user's own outcome notes ("what happened", "what I'd change")
 * into proposed rules for specific skills. Code checks each one: a real
 * skill, real applications cited, a job type that was in the notes, and no
 * number the notes don't contain. The user still accepts or dismisses each.
 */
export async function rulesFromNotes(input: z.infer<typeof NotesInput>): Promise<{ rules: NoteRule[]; dropped: number; source: "ai" | "rules" }> {
  if (!aiEnabled()) return { rules: [], dropped: 0, source: "rules" };
  try {
    const out = await callTool({
      action: "rules_from_notes",
      tool: "propose_rules",
      description: "Propose short, specific job-search rules drawn from the user's own outcome notes, each attached to one skill.",
      schema: z.object({
        rules: z.array(z.object({ skill: z.string(), family: z.string().nullable(), text: z.string().max(220), appIds: z.array(z.string()).min(1).max(10) })).max(6),
      }),
      system: [
        "You read a job seeker's own notes about how applications ended and what they'd change, and propose up to 6 rules for next time.",
        `Each rule belongs to exactly one skill: ${SKILL_IDS.map((id) => `${id} (${SKILLS[id].does})`).join("; ")}.`,
        "A rule is one imperative sentence (max 25 words), specific and actionable. family = the job type it applies to if the notes are about one, else null.",
        "appIds = the notes it comes from. Only propose a rule the notes actually support; if notes disagree, skip it. Don't repeat existing rules.",
        "Use a number only if it appears in the cited notes. No em dashes. Never invent companies or names.",
        DATA_RULE,
      ].join("\n"),
      user: [asData("notes", JSON.stringify(input.notes)), input.existing.length ? asData("existing_rules", input.existing.join("\n")) : ""].filter(Boolean).join("\n\n"),
      maxTokens: 1200,
    });
    const byId = new Map(input.notes.map((n) => [n.appId, n]));
    const families = new Set(input.notes.map((n) => n.family));
    const rules: NoteRule[] = [];
    let dropped = 0;
    for (const r of out.rules) {
      const skill = SKILL_IDS.find((id) => id === r.skill);
      const cited = r.appIds.filter((id) => byId.has(id));
      const text = r.text.trim();
      const ok =
        skill &&
        cited.length > 0 &&
        (r.family === null || families.has(r.family)) &&
        text.length >= 15 &&
        !/—/.test(text) &&
        numbersAreGrounded(text, cited.map((id) => `${byId.get(id)!.notes} ${byId.get(id)!.learning}`));
      if (!ok) {
        dropped++;
        continue;
      }
      rules.push({ key: `notes|${r.family ?? "all"}|${fnv1a(text.toLowerCase()).toString(36)}`, skill: skill!, family: r.family, text, appIds: cited });
    }
    if (dropped) log("info", "notes_rules.rejected_by_validator", { dropped });
    return { rules, dropped, source: "ai" };
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) log("warn", "notes_rules.failed", { error: errorMessage(e) });
    return { rules: [], dropped: 0, source: "rules" };
  }
}
