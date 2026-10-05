import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "@/lib/schemas";
import { BACKGROUND, JOB, RECIPIENT, RESUME } from "@/lib/samples";
import { buildDemoData, DEMO_RESUME } from "@/lib/demo";
import { buildStrategyFacts } from "@/lib/strategy";

const callTool = vi.fn();
vi.mock("../ai", async (orig) => {
  const real = await orig<typeof import("../ai")>();
  return { ...real, aiEnabled: () => true, callTool: (...args: unknown[]) => callTool(...args) };
});

const { analyzeFit, draftMessage, interviewPrep, numbersAreGrounded, rewordRules, rulesFromNotes, strategyNarrative, tailorResume } = await import("../services");
const { compose } = await import("../skills");

const baseInput = {
  recipientText: RECIPIENT,
  jobText: JOB,
  background: BACKGROUND,
  resume: RESUME,
  myName: "Jordan Rivera",
  stage: "accepted_followup" as const,
  channel: "linkedin" as const,
  recipientType: null,
  premium: false,
  fit: null,
  instruction: null,
  regeneratePart: null,
  current: null,
  guidance: null,
  skills: null,
};

const goodDraft: Draft = {
  subject: null,
  greeting: "Hi Sam,",
  signoff: "Best,\nJordan Rivera",
  segments: [
    { part: "connection", text: "Fellow Lakeshore College grad here.", claims: [{ text: "Lakeshore College", source: "recipient", quote: "Lakeshore College" }] },
    { part: "background", text: "I built Python validation checks for 100,000+ claims records.", claims: [{ text: "Python validation checks", source: "me", quote: "Built Python validation checks for 100,000+ claims records" }] },
    { part: "learn", text: "I would love to hear what the growth team is focused on.", claims: [] },
    { part: "ask", text: "Would you have 15 minutes in the next few weeks?", claims: [] },
  ],
};

beforeEach(() => {
  callTool.mockReset();
});

describe("analyzeFit", () => {
  it("recomputes the score and drops quotes that are not in the resume", async () => {
    callTool.mockResolvedValueOnce({
      meta: { role: "Growth Engineer", company: "Tunewise", seniority: "entry", companyType: "startup" },
      ratings: [
        { requirement: "React and TypeScript", evidence: "strong", resumeQuote: "Built a React and TypeScript experiment dashboard with live A/B assignment", gapTag: null, weight: 1 },
        { requirement: "Music industry", evidence: "strong", resumeQuote: "Led growth at a music startup", gapTag: null, weight: 1 },
      ],
    });
    const r = await analyzeFit({ jobText: JOB, resume: RESUME, background: BACKGROUND });
    expect(r.source).toBe("ai");
    expect(r.ratings[1].resumeQuote).toBeNull();
    expect(r.ratings[1].evidence).toBe("partial");
    expect(r.score).toBe(75);
  });
});

describe("draftMessage", () => {
  it("accepts a draft that passes every check", async () => {
    callTool.mockResolvedValueOnce(goodDraft);
    const r = await draftMessage(baseInput);
    expect(r.source).toBe("ai");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("retries once when the validator finds an invented name, then accepts the fix", async () => {
    const bad: Draft = { ...goodDraft, segments: [{ part: "connection", text: "Loved your talk at Stanford Summit.", claims: [] }, ...goodDraft.segments.slice(1)] };
    callTool.mockResolvedValueOnce(bad).mockResolvedValueOnce(goodDraft);
    const r = await draftMessage(baseInput);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(String(callTool.mock.calls[1][0].user)).toContain("Stanford Summit");
    expect(r.source).toBe("ai");
  });

  it("falls back to the rules draft when both attempts fail validation", async () => {
    const bad: Draft = { ...goodDraft, segments: [{ part: "connection", text: "Loved your talk at Stanford Summit.", claims: [] }] };
    callTool.mockResolvedValue(bad);
    const r = await draftMessage(baseInput);
    expect(r.source).toBe("rules");
    expect(JSON.stringify(r.draft)).not.toContain("Stanford Summit");
  });

  it("falls back to rules when the AI call throws", async () => {
    callTool.mockImplementation(async () => {
      throw new Error("overloaded");
    });
    const r = await draftMessage(baseInput);
    expect(r.source).toBe("rules");
  });
});

describe("strategy narrative", () => {
  const facts = buildStrategyFacts(buildDemoData().applications, DEMO_RESUME);
  it("rejects prose containing numbers that are not in the facts", async () => {
    callTool.mockResolvedValueOnce({ summary: "You were rejected 97 times.", targetWhy: [] });
    const r = await strategyNarrative(facts);
    expect(r.source).toBe("rules");
  });
  it("numbersAreGrounded accepts percentages of computed rates", () => {
    expect(numbersAreGrounded("50% of the time", { rate: 0.5 })).toBe(true);
    expect(numbersAreGrounded("12 times", { count: 3 })).toBe(false);
  });
});

describe("playbook rewording", () => {
  const rules = [{ key: "resume|all|v2", text: "Across your applications, apply with resume v2.", evidence: "v2: 6 of 9 got a response; other versions: 2 of 10." }];
  it("accepts a rewrite whose numbers come from the evidence", async () => {
    callTool.mockResolvedValueOnce({ rules: [{ key: "resume|all|v2", text: "Send resume v2; it got 6 of 9 responses." }] });
    const [r] = await rewordRules({ rules });
    expect(r.source).toBe("ai");
  });
  it("falls back when the rewrite invents a number or uses an em dash", async () => {
    callTool.mockResolvedValueOnce({ rules: [{ key: "resume|all|v2", text: "Send resume v2; it doubles responses to 80%." }] });
    expect((await rewordRules({ rules }))[0]).toMatchObject({ source: "rules", text: rules[0].text });
    callTool.mockResolvedValueOnce({ rules: [{ key: "resume|all|v2", text: "Use resume v2 — it works better here." }] });
    expect((await rewordRules({ rules }))[0].source).toBe("rules");
  });
});

describe("draft guidance", () => {
  it("passes the learned opener and rules to the model", async () => {
    callTool.mockResolvedValueOnce(goodDraft);
    await draftMessage({ ...baseInput, guidance: { opener: "shared_school", maxChars: 150, rules: ["Message alumni first."] } });
    const prompt = String(callTool.mock.calls[0][0].user);
    expect(prompt).toContain("Open with the shared school.");
    expect(prompt).toContain("under 150 characters");
    expect(prompt).toContain("Message alumni first.");
  });
  it("rules fallback leads with the role when guidance says role-led", async () => {
    callTool.mockImplementation(async () => {
      throw new Error("down");
    });
    const r = await draftMessage({ ...baseInput, guidance: { opener: "role_led", maxChars: null, rules: [] } });
    expect(r.source).toBe("rules");
    expect(r.draft.segments[0].text).not.toMatch(/Lakeshore/);
  });
});

const skills = {
  family: "Growth",
  learned: [{ id: "learned/lead|Growth|x", skill: "resume-tailor" as const, text: "Keep the experiment dashboard in your top three bullets.", evidence: "3 of 4 vs 1 of 5.", tier: "early" as const, origin: "outreach" as const }],
  working: [{ id: "resume-quantifier/numbers", evidence: "Growth roles: when followed, 4 of 5 got a response; when not, 1 of 4." }],
  paused: [{ id: "resume-ats-optimizer/headings", evidence: "Growth roles: when followed, 1 of 5 got a response; when not, 3 of 4." }],
  explore: ["learned/held-back"],
  profile: ["Growth: 4 of 9 applications got a response."],
  chains: [],
  versions: { "resume-tailor": 3 },
};

describe("skills in prompts", () => {
  it("sends the primary baseline skill in full and lists exactly what the manifest says", async () => {
    const c = await compose("tailor_resume", "tailor", skills);
    expect(c.prefix).toContain('<skill name="resume-tailor" source="baseline">');
    expect(c.prefix).toContain("# Resume Tailor");
    expect(c.prefix).toContain("[resume-quantifier]");
    for (const r of c.manifest.learned) expect(c.personal).toContain(r.text);
    for (const r of [...c.manifest.working, ...c.manifest.paused]) expect(c.personal).toContain(r.text);
    for (const f of c.manifest.profile) expect(c.personal).toContain(f);
    expect(c.personal).not.toContain("held-back");
    expect(c.manifest.skills[0]).toMatchObject({ id: "resume-tailor", mode: "full", version: 3 });
  });
  it("baseline-only sends no personal layer", async () => {
    const c = await compose("tailor_resume", "tailor", skills, { baselineOnly: true });
    expect(c.personal).not.toContain("Keep the experiment dashboard");
    expect(c.manifest.learned).toEqual([]);
    expect(c.personal).toContain("House rules");
  });
  it("drafts with the cold-email skill cached and the user's layer in the prompt", async () => {
    callTool.mockResolvedValueOnce(goodDraft);
    const draftSkills = { ...skills, learned: [{ ...skills.learned[0], id: "learned/opener|x", skill: "cold-email-writer" as const, text: "Open with the shared school." }] };
    const r = await draftMessage({ ...baseInput, skills: draftSkills });
    const call = callTool.mock.calls[0][0];
    expect(call.cachedPrefix).toContain('<skill name="cold-email-writer"');
    expect(call.system).toContain("Open with the shared school.");
    expect(r.context?.learned.map((x) => x.text)).toEqual(["Open with the shared school."]);
  });
});

describe("tailorResume", () => {
  const input = { resume: RESUME, jobText: JOB, fit: null, role: "Growth Engineer", company: "Tunewise", skills, baselineOnly: false, boosts: [] };
  const bullet = (text: string) => {
    const i = RESUME.split("\n").findIndex((l) => l.includes(text));
    return `l${i}`;
  };
  it("keeps grounded edits and blocks invented ones", async () => {
    callTool.mockResolvedValueOnce({
      summary: null,
      edits: [
        { lineId: bullet("Designed SQL dashboards"), text: "Built SQL dashboards for the operations team", ruleIds: ["resume-bullet-writer/action-verbs"], why: "Stronger verb." },
        { lineId: bullet("Built Python validation"), text: "Built Python validation checks for 2,000,000 claims records", ruleIds: [], why: "" },
      ],
      order: [],
      talkingPoints: [],
      applied: ["learned/lead|Growth|x"],
    });
    const r = await tailorResume(input);
    expect(r.source).toBe("ai");
    expect(r.changes).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/number/);
    expect(r.applied).toContain("learned/lead|Growth|x");
    expect(r.context?.learned).toHaveLength(1);
  });
  it("the baseline comparison sends no learned rules", async () => {
    callTool.mockResolvedValueOnce({ summary: null, edits: [], order: [], talkingPoints: [], applied: [] });
    const r = await tailorResume({ ...input, baselineOnly: true });
    expect(callTool.mock.calls[0][0].system).not.toContain("Keep the experiment dashboard");
    expect(r.context?.baselineOnly).toBe(true);
  });
  it("falls back to reordering only when the AI fails", async () => {
    callTool.mockRejectedValueOnce(new Error("down"));
    const r = await tailorResume(input);
    expect(r.source).toBe("rules");
    expect(r.changes.every((c) => c.kind === "moved")).toBe(true);
  });
});

describe("interviewPrep", () => {
  it("replaces unsupported details with [fill in]", async () => {
    callTool.mockResolvedValueOnce({
      questions: [{ question: "Tell me about an experiment.", requirement: "A/B testing", quote: "Ran 40 experiments at Spotify", star: { situation: "At Spotify", task: "t", action: "Built a React and TypeScript experiment dashboard", result: "Lifted retention 12%" } }],
      questionsForThem: ["What does success look like?"],
    });
    const r = await interviewPrep({ resume: RESUME, jobText: JOB, fit: null, role: "Growth Engineer", skills: null });
    const q = r.prep.questions[0];
    expect(q.quote).toBeNull();
    expect(q.star.result).toBe("[fill in]");
    expect(r.fixed).toBeGreaterThan(0);
  });
});

describe("rulesFromNotes", () => {
  const notes = [{ appId: "a1", family: "Product", result: "rejected", reason: "domain", reasonSource: "interviewer_feedback", notes: "They wanted a product teardown.", learning: "Prepare one teardown story." }];
  it("keeps rules tied to real notes and a real skill; drops the rest", async () => {
    callTool.mockResolvedValueOnce({
      rules: [
        { skill: "interview-prep-generator", family: "Product", text: "Prepare one product teardown story before product interviews.", appIds: ["a1"] },
        { skill: "made-up-skill", family: null, text: "Do something else entirely here.", appIds: ["a1"] },
        { skill: "resume-tailor", family: null, text: "Teardowns raise response rates by 40%.", appIds: ["a1"] },
        { skill: "resume-tailor", family: "Growth", text: "Lead with growth projects on every resume.", appIds: ["a1"] },
        { skill: "resume-tailor", family: null, text: "Mention teardowns in the summary line.", appIds: ["zzz"] },
      ],
    });
    const r = await rulesFromNotes({ notes, existing: [] });
    expect(r.rules.map((x) => x.skill)).toEqual(["interview-prep-generator"]);
    expect(r.dropped).toBe(4);
    expect(r.rules[0].key).toMatch(/^notes\|Product\|/);
  });
});

describe("only accepted rules reach the model", () => {
  it("proposed, dismissed and paused rules never appear in the prompt", async () => {
    const { skillContext } = await import("@/lib/skills/personal");
    const base = { scope: "resume" as const, family: null, evidence: "3 of 4 vs 1 of 4.", tier: "early" as const, source: "rules" as const, createdAt: 0, updatedAt: 0, skill: "resume-tailor" as const, origin: "outcomes" as const };
    const ctx = skillContext({
      use: "tailor",
      family: null,
      rules: [
        { ...base, key: "a", text: "ACCEPTED RULE", status: "accepted", current: true },
        { ...base, key: "b", text: "PROPOSED RULE", status: "proposed", current: true },
        { ...base, key: "c", text: "DISMISSED RULE", status: "rejected", current: true },
        { ...base, key: "d", text: "UNSUPPORTED RULE", status: "accepted", current: false },
      ],
      scores: [],
      seed: 1,
      exploreCap: 0,
    });
    const c = await compose("tailor_resume", "tailor", ctx);
    const prompt = `${c.prefix}\n${c.personal}`;
    expect(prompt).toContain("ACCEPTED RULE");
    for (const t of ["PROPOSED RULE", "DISMISSED RULE", "UNSUPPORTED RULE"]) expect(prompt).not.toContain(t);
    expect(c.manifest.learned.map((r) => r.text)).toEqual(["ACCEPTED RULE"]);
  });
});
