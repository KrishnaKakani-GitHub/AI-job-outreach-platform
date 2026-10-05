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
});

export interface DraftResult {
  draft: Draft;
  shared: SharedGround[];
  recipient: { firstName: string | null; title: string | null; recipientType: z.infer<typeof RecipientType>; reason: string; suggested: boolean };
  meta: { role: string; company: string | null };
  limit: number | null;
  issues: Issue[];
  source: "ai" | "rules";
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
    let feedback: Issue[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const draft = await aiDraft(input, ctx, shared, src, limit, feedback);
        const fitted = fitToLimit(draft, limit);
        const v = validateDraft(fitted, src, limit);
        if (v.ok) return { ...base, draft: fitted, issues: v.issues, source: "ai" };
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
  return { ...base, draft, issues: validateDraft(draft, src, limit).issues, source: "rules" };
}

async function aiDraft(
  input: z.infer<typeof DraftInput>,
  ctx: DraftContext,
  shared: SharedGround[],
  src: { recipient: string; me: string; job: string },
  limit: number | null,
  feedback: Issue[],
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
  return callTool({ action: "draft_message", tool: "write_draft", description: "Return the outreach draft as structured segments with grounded claims.", schema: Draft, system, user, maxTokens: 1500 });
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
