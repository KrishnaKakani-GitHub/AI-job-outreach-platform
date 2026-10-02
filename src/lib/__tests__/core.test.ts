import { describe, expect, it } from "vitest";
import { classifyDocument, extractJobMeta, extractRecipientMeta, extractRequirements } from "../classify";
import { buildChecklist, buildFitReport, computeScore, rateRequirementsByRules, sanitizeRatings } from "../fit";
import { detectSharedGround } from "../shared";
import { charLimit, renderDraft, rulesDraft, templateDraft, type DraftContext } from "../draft";
import { checkGrounding, checkStyle, checkUnknownNames, validateDraft } from "../validators";
import { assignVariant, editRatio } from "../ab";
import { BACKGROUND, JOB, RECIPIENT, RECIPIENT_MANAGER, RESUME } from "./fixtures";
import type { Draft } from "../schemas";

describe("classifyDocument", () => {
  it("labels each kind of paste", () => {
    expect(classifyDocument(JOB).kind).toBe("job_description");
    expect(classifyDocument(RESUME).kind).toBe("resume");
    expect(classifyDocument(RECIPIENT).kind).toBe("recipient_profile");
    expect(classifyDocument(BACKGROUND).kind).toBe("background");
  });
});

describe("job extraction", () => {
  it("finds role, company, seniority, company type", () => {
    const m = extractJobMeta(JOB);
    expect(m.role).toBe("Growth Engineer");
    expect(m.company).toBe("Tunewise");
    expect(m.seniority).toBe("entry");
    expect(m.companyType).toBe("startup");
  });
  it("pulls requirement bullets and down-weights nice-to-haves", () => {
    const reqs = extractRequirements(JOB);
    expect(reqs.some((r) => /SQL and Python/.test(r.text))).toBe(true);
    expect(reqs.find((r) => /music/.test(r.text))?.weight).toBe(0.75);
    expect(reqs.some((r) => /Health insurance/.test(r.text))).toBe(false);
  });
});

describe("recipient extraction", () => {
  it("detects a recruiter from the title", () => {
    const m = extractRecipientMeta(RECIPIENT, true);
    expect(m.firstName).toBe("Sam");
    expect(m.recipientType).toBe("recruiter");
  });
  it("detects a hiring manager", () => {
    expect(extractRecipientMeta(RECIPIENT_MANAGER, false).recipientType).toBe("hiring_manager");
  });
});

describe("fit scoring", () => {
  it("computes a weighted score", () => {
    expect(computeScore([{ evidence: "strong", weight: 1 }, { evidence: "missing", weight: 1 }])).toBe(50);
    expect(computeScore([{ evidence: "partial", weight: 2 }])).toBe(50);
  });
  it("demotes strong ratings whose quote is not in the resume", () => {
    const [r] = sanitizeRatings([{ requirement: "SQL", evidence: "strong", resumeQuote: "Invented quote", gapTag: null, weight: 1 }], RESUME);
    expect(r.evidence).toBe("partial");
    expect(r.resumeQuote).toBeNull();
  });
  it("produces a report with quotes that exist in the resume", () => {
    const ratings = rateRequirementsByRules(JOB, RESUME);
    const report = buildFitReport(extractJobMeta(JOB), ratings, RESUME, "rules");
    expect(report.score).toBeGreaterThan(0);
    for (const r of report.ratings) if (r.resumeQuote) expect(RESUME).toContain(r.resumeQuote);
  });
  it("turns recurring gaps into checklist questions", () => {
    const fit = buildFitReport(extractJobMeta(JOB), rateRequirementsByRules(JOB, RESUME), RESUME, "rules");
    const items = buildChecklist([{ fit: { ...fit, gaps: ["ownership"] } }, { fit: { ...fit, gaps: ["ownership"] } }], null);
    expect(items[0].tag).toBe("ownership");
    expect(items[0].occurrences).toBe(2);
  });
});

describe("shared ground", () => {
  it("finds the shared school with quotes from both sides", () => {
    const sg = detectSharedGround(`${BACKGROUND}\n${RESUME}`, RECIPIENT);
    const school = sg.find((s) => s.kind === "school");
    expect(school?.label).toBe("Lakeshore College");
    expect(RECIPIENT).toContain(school!.recipientQuote);
  });
  it("returns nothing when there is no overlap", () => {
    expect(detectSharedGround("I studied at Ridge University in Denver.", "Mo Li\nDesigner at Acme\nToronto").filter((s) => s.kind !== "domain")).toHaveLength(0);
  });
});

const ctx = (over: Partial<DraftContext> = {}): DraftContext => {
  const fit = buildFitReport(extractJobMeta(JOB), rateRequirementsByRules(JOB, RESUME), RESUME, "rules");
  return {
    stage: "accepted_followup",
    channel: "linkedin",
    recipientType: "recruiter",
    recipientFirstName: "Sam",
    myName: "Jordan Rivera",
    role: "Growth Engineer",
    company: "Tunewise",
    shared: detectSharedGround(`${BACKGROUND}\n${RESUME}`, RECIPIENT),
    fit,
    premium: false,
    ...over,
  };
};
const SRC = { recipient: RECIPIENT, me: `${BACKGROUND}\n${RESUME}`, job: JOB };

describe("drafting", () => {
  it("rules draft passes every validator", () => {
    const d = rulesDraft(ctx());
    const v = validateDraft(d, SRC, null);
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
  it("invite notes fit the 200-character LinkedIn cap", () => {
    const c = ctx({ stage: "invite_note" });
    const d = rulesDraft(c);
    expect(renderDraft(d).length).toBeLessThanOrEqual(charLimit(c.stage, c.channel, false)!);
  });
  it("email drafts get a subject line", () => {
    expect(rulesDraft(ctx({ channel: "email" })).subject).toBeTruthy();
    expect(templateDraft(ctx({ channel: "email" })).subject).toBeTruthy();
  });
  it("the template variant has blanks to fill", () => {
    expect(renderDraft(templateDraft(ctx()))).toContain("[");
  });
});

describe("validators", () => {
  const base: Draft = { subject: null, greeting: "Hi Sam,", signoff: "Best,\nJordan", segments: [{ part: "connection", text: "Fellow Lakeshore College grad here.", claims: [] }] };
  it("flags claims that quote text not in the source", () => {
    const d: Draft = { ...base, segments: [{ part: "connection", text: "We both ran track.", claims: [{ text: "ran track", source: "recipient", quote: "Varsity track captain" }] }] };
    expect(checkGrounding(d, SRC)[0].kind).toBe("ungrounded");
  });
  it("flags invented names", () => {
    const d: Draft = { ...base, segments: [{ part: "connection", text: "I loved your talk at Stanford Summit.", claims: [] }] };
    expect(checkUnknownNames(d, SRC).some((i) => i.message.includes("Stanford Summit"))).toBe(true);
  });
  it("accepts names that exist in a source", () => {
    expect(checkUnknownNames(base, SRC)).toEqual([]);
  });
  it("flags em dashes and filler", () => {
    const d: Draft = { ...base, segments: [{ part: "connection", text: "I hope this message finds you well — truly.", claims: [] }] };
    expect(checkStyle(d).length).toBe(2);
  });
});

describe("A/B helpers", () => {
  it("assigns deterministically and roughly evenly", () => {
    expect(assignVariant("abc12345")).toBe(assignVariant("abc12345"));
    let b = 0;
    for (let i = 0; i < 2000; i++) if (assignVariant(`user-${i}-xxxxxx`) === "B") b++;
    expect(b / 2000).toBeGreaterThan(0.45);
    expect(b / 2000).toBeLessThan(0.55);
  });
  it("edit ratio is 0 for identical and 1 for disjoint", () => {
    expect(editRatio("abc", "abc")).toBe(0);
    expect(editRatio("abc", "xyz")).toBe(1);
  });
});
