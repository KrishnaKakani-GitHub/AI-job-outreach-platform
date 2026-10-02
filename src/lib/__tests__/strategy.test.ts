import { describe, expect, it } from "vitest";
import { buildDemoData, DEMO_RESUME } from "../demo";
import { computeInsights, furthestStage, roleFamily, UNLOCK_OUTREACH } from "../insights";
import { buildStrategyFacts, finalRoundRejections, languageFixes, resumeTweaks, strategyStatus } from "../strategy";
import type { Application } from "../schemas";

const { applications, contacts } = buildDemoData(11, Date.UTC(2026, 9, 1));

describe("insights", () => {
  it("unlocks at the outreach threshold", () => {
    const sent = contacts.filter((c) => c.stage !== "drafted").length;
    expect(computeInsights(applications, contacts).unlocked).toBe(sent >= UNLOCK_OUTREACH);
    expect(computeInsights(applications, []).unlocked).toBe(false);
  });
  it("every rate carries an interval that contains the point estimate", () => {
    const ins = computeInsights(applications, contacts);
    for (const r of [ins.interviewConversion, ...ins.rejectionByRole, ...ins.responseByCompanyType]) {
      expect(r.ci.low).toBeLessThanOrEqual(r.rate + 1e-9);
      expect(r.ci.high).toBeGreaterThanOrEqual(r.rate - 1e-9);
      expect(r.enough).toBe(r.n >= 5);
    }
  });
  it("tracks furthest stage even after rejection", () => {
    const a = { stage: "rejected", history: [{ stage: "applied", at: 1 }, { stage: "final_round", at: 2 }, { stage: "rejected", at: 3 }] } as Pick<Application, "stage" | "history">;
    expect(furthestStage(a)).toBe("final_round");
  });
  it("maps roles to families", () => {
    expect(roleFamily("Product Manager: New Grad Accelerator")).toBe("Product");
    expect(roleFamily("Growth Engineer")).toBe("Growth");
    expect(roleFamily("Associate Data Analyst")).toBe("Analyst");
  });
});

describe("strategy", () => {
  it("requires enough applications and outcomes", () => {
    expect(strategyStatus(applications.slice(0, 3)).unlocked).toBe(false);
    expect(strategyStatus(applications).unlocked).toBe(true);
  });
  it("ranks targets and orders apply-next by fit", () => {
    const f = buildStrategyFacts(applications, DEMO_RESUME);
    expect(f.targets.length).toBeGreaterThan(0);
    for (let i = 1; i < f.apply.length; i++) expect(f.apply[i - 1].score).toBeGreaterThanOrEqual(f.apply[i].score);
  });
  it("resume tweaks only reuse real bullets and mark missing facts", () => {
    const t = resumeTweaks(DEMO_RESUME, ["quantified_impact", "ownership"]);
    for (const x of t) {
      expect(DEMO_RESUME).toContain(x.original);
      expect(x.scaffold).toContain("[");
      expect(x.needsInput.length).toBeGreaterThan(0);
    }
  });
  it("suggests market vocabulary the resume is missing", () => {
    const fixes = languageFixes(applications, "I ran model evaluation and benchmarking.");
    const exp = fixes.find((f) => f.marketTerm === "experimentation");
    expect(exp?.yourTerm).toBe("evaluation");
  });
  it("finds final-round rejections", () => {
    for (const a of finalRoundRejections(applications)) {
      expect(a.stage).toBe("rejected");
      expect(a.history.some((h) => h.stage === "final_round")).toBe(true);
    }
  });
});
