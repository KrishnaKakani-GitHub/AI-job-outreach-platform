/**
 * Interview prep from the job post and the user's own resume.
 *
 * Each likely question is tied to one requirement in the post. Its STAR
 * outline may only quote the resume; anything the resume doesn't say is left
 * as [fill in] for the user. validatePrep() enforces that on model output.
 */
import { z } from "zod";
import type { FitReport } from "./schemas";
import { parseCv } from "./resume";
import { containsLoose, keywords } from "./text";

export const PrepQuestion = z.object({
  question: z.string().max(300),
  requirement: z.string().max(300),
  /** Verbatim resume line the story is built on, or null if the resume has none. */
  quote: z.string().max(400).nullable(),
  star: z.object({
    situation: z.string().max(300),
    task: z.string().max(300),
    action: z.string().max(400),
    result: z.string().max(300),
  }),
});
export type PrepQuestion = z.infer<typeof PrepQuestion>;

export const InterviewPrep = z.object({
  questions: z.array(PrepQuestion).min(1).max(8),
  questionsForThem: z.array(z.string().max(240)).max(4).default([]),
});
export type InterviewPrep = z.infer<typeof InterviewPrep>;

export const FILL = "[fill in]";

const NUM = /\d+(?:[.,]\d+)?%?/g;

function groundedNumbers(text: string, source: string): boolean {
  const allowed = new Set((source.match(NUM) ?? []).map((n) => n.replace(/,/g, "")));
  return (text.replace(/\[fill in\]/gi, "").match(NUM) ?? []).every((n) => allowed.has(n.replace(/,/g, "")));
}

const QUESTION: Record<string, (req: string) => string> = {
  tooling: (r) => `Walk me through how you've used this: ${r}.`,
  ownership: () => "Tell me about something you owned from start to finish.",
  quantified_impact: () => "Tell me about a result you measured. How did you know it worked?",
  domain_visibility: (r) => `What do you know about this area, and how does your experience connect to it? (${r})`,
  requirement_evidence: (r) => `Give me an example of this from your experience: ${r}.`,
};

/** Rules-only prep: one question per top requirement, STAR scaffold from the matching resume bullet. */
export function rulesPrep(fit: FitReport | null, jobText: string, resume = ""): InterviewPrep {
  const bullets = parseCv(resume).bullets.map((b) => b.text);
  const asBullet = (q: string | null) => (q ? (bullets.find((b) => b.includes(q.slice(0, 40)) || q.includes(b.slice(0, 40))) ?? null) : null);
  /** The bullet sharing the most terms with the requirement, if any shares one. */
  const bestBullet = (req: string) => {
    const want = new Set(keywords(req));
    const scored = bullets.map((b) => ({ b, n: keywords(b).filter((k) => want.has(k)).length })).sort((x, y) => y.n - x.n);
    return scored[0]?.n ? scored[0].b : null;
  };
  const reqs = (fit?.ratings ?? [])
    .filter((r) => r.gapTag !== "seniority" && !/\byears?\b/i.test(r.requirement))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);
  const questions: PrepQuestion[] = reqs.map((r) => {
    const quote = asBullet(r.resumeQuote) ?? bestBullet(r.requirement);
    const ask = QUESTION[r.gapTag ?? "requirement_evidence"] ?? QUESTION.requirement_evidence;
    return {
      question: ask(r.requirement.replace(/\.$/, "")),
      requirement: r.requirement,
      quote,
      star: { situation: FILL, task: FILL, action: quote ?? FILL, result: FILL },
    };
  });
  if (!questions.length) {
    questions.push({ question: "Walk me through the project on your resume you're proudest of.", requirement: jobText.split("\n")[0]?.slice(0, 120) || "The role", quote: null, star: { situation: FILL, task: FILL, action: FILL, result: FILL } });
  }
  return {
    questions,
    questionsForThem: ["What does success look like in the first 90 days?", "What is the team's biggest priority this quarter?", "How do you measure the impact of this role?"],
  };
}

const CAP = /(?<=\S\s+)([A-Z][a-zA-Z0-9&+.#-]+)/g;
const COMMON = new Set("I STAR SQL API".split(" "));

/** Capitalized words mid-sentence (names, tools, companies) must appear in the resume or the job post. */
function namesGrounded(text: string, source: string): boolean {
  for (const m of text.matchAll(CAP)) {
    const w = m[1].replace(/[.,]$/, "");
    if (COMMON.has(w)) continue;
    if (!new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(source)) return false;
  }
  return true;
}

/** Drop quotes that aren't in the resume and replace ungrounded STAR parts with [fill in]. */
export function validatePrep(prep: InterviewPrep, resume: string, jobText = ""): { prep: InterviewPrep; fixed: number } {
  let fixed = 0;
  const questions = prep.questions.map((q) => {
    const quote = q.quote && containsLoose(resume, q.quote) ? q.quote : null;
    if (q.quote && !quote) fixed++;
    const source = `${resume}\n${quote ?? ""}`;
    const star = Object.fromEntries(
      Object.entries(q.star).map(([k, v]) => {
        if (/—/.test(v) || !groundedNumbers(v, source) || !namesGrounded(v, `${source}\n${jobText}`)) {
          fixed++;
          return [k, FILL];
        }
        return [k, v];
      }),
    ) as PrepQuestion["star"];
    return { ...q, quote, star };
  });
  return { prep: { ...prep, questions }, fixed };
}
