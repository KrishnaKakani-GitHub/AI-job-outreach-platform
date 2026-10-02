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

const { analyzeFit, draftMessage, numbersAreGrounded, strategyNarrative } = await import("../services");

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
