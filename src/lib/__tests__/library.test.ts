/**
 * Several tailored resumes, one rule: once a resume is saved, the chat never
 * says it wasn't received. Covers the resume library, tailored-resume
 * detection, what the chat is told, and the deterministic reply guard.
 */
import { describe, expect, it } from "vitest";
import { classifyDocument } from "../classify";
import { addResume, type ResumeLibrary } from "../ingest";
import { buildChatRequest, guardResumeClaims } from "../chat";

const GENERAL = `Sam Rivera  sam.rivera@example.com  (555) 010-2030
EDUCATION
State University, B.S. Public Health, May 2025
EXPERIENCE
County Health Dept, Policy Intern   Jun 2024 - Aug 2024
- Built a dashboard tracking Medicaid enrollment across 12 counties
- Wrote two policy briefs on access to primary care`;

/** Tailored to a posting: carries the posting's own vocabulary. */
const TAILORED = `Sam Rivera  sam.rivera@example.com  (555) 010-2030
SUMMARY
Policy analyst with qualifications in market access; you will find requirements-driven research,
remote and hybrid collaboration, and 2+ years of health policy work. We are looking for impact, and so am I.
EXPERIENCE
County Health Dept, Policy Intern   Jun 2024 - Aug 2024
- Built a market access model covering 12 counties; responsibilities included payer research
EDUCATION
State University, B.S. Public Health, May 2025`;

const empty: ResumeLibrary = { resume: "", resumeVersion: "v1", resumes: [] };

describe("resume library", () => {
  it("saves the first resume as v1", () => {
    const lib = addResume(empty, GENERAL, 100);
    expect(lib).toMatchObject({ resume: GENERAL, resumeVersion: "v1", added: true });
    expect(lib.resumes).toEqual([{ version: "v1", text: GENERAL, savedAt: 100 }]);
  });
  it("keeps each tailored resume as its own version and makes the newest current", () => {
    const one = addResume(empty, GENERAL, 100);
    const two = addResume(one, TAILORED, 200);
    expect(two).toMatchObject({ resume: TAILORED, resumeVersion: "v2", added: true });
    expect(two.resumes.map((r) => r.version)).toEqual(["v1", "v2"]);
  });
  it("switches back instead of duplicating when a saved resume is pasted again", () => {
    const lib = addResume(addResume(addResume(empty, GENERAL, 100), TAILORED, 200), `  ${GENERAL.replace(/\n/g, "\n\n")} `, 300);
    expect(lib).toMatchObject({ resumeVersion: "v1", added: false });
    expect(lib.resumes).toHaveLength(2);
  });
  it("keeps a resume saved before the library existed as its first version", () => {
    const legacy: ResumeLibrary = { resume: GENERAL, resumeVersion: "v3", resumes: [] };
    const lib = addResume(legacy, TAILORED, 500);
    expect(lib.resumes.map((r) => r.version)).toEqual(["v3", "v4"]);
    expect(lib.resumes[0].text).toBe(GENERAL);
  });
  it("keeps a resume edited in the Profile panel without reusing its label", () => {
    const one = addResume(empty, GENERAL, 100);
    const edited: ResumeLibrary = { ...one, resume: `${GENERAL}\n- Edited by hand` };
    const lib = addResume(edited, TAILORED, 200);
    expect(lib.resumes.map((r) => r.version)).toEqual(["v1", "v2", "v3"]);
    expect(new Set(lib.resumes.map((r) => r.version)).size).toBe(3);
    expect(lib.resumeVersion).toBe("v3");
  });
  it("numbers after custom labels without colliding", () => {
    const custom: ResumeLibrary = { resume: GENERAL, resumeVersion: "fall-2026", resumes: [{ version: "fall-2026", text: GENERAL, savedAt: 1 }] };
    expect(addResume(custom, TAILORED, 2).resumeVersion).toBe("fall-2026-2");
  });
  it("caps the library and never drops the new current version", () => {
    let lib: ResumeLibrary = empty;
    for (let i = 0; i < 25; i++) lib = addResume(lib, `${GENERAL}\n- Project ${i}`, i);
    expect(lib.resumes).toHaveLength(20);
    expect(lib.resumes.some((r) => r.version === lib.resumeVersion)).toBe(true);
  });
});

describe("tailored resumes are filed as resumes", () => {
  it("files a resume full of job-post words as a resume", () => {
    const c = classifyDocument(TAILORED);
    expect(c.scores.job_description).toBeGreaterThanOrEqual(0.75);
    expect(c.kind).toBe("resume");
  });
});

describe("what the chat is told", () => {
  const lib = addResume(addResume(empty, GENERAL, 100), TAILORED, 200);
  const r = buildChatRequest({ messages: [], text: "which version should I send?", profile: { ...lib, background: "" }, app: null });
  it("states the resume was received and lists every version", () => {
    expect(r.context).toContain("Resume status: RECEIVED and saved. Current version v2. Other saved versions: v1.");
    expect(r.context).toContain("The user's saved resume (v2)");
    expect(r.context).toContain("Saved resume v1:");
  });
});

describe("guardResumeClaims", () => {
  const saved = { has: true, version: "v2", count: 2 };
  const cases = [
    "I don't see a resume in this chat.",
    "Your first message came through empty, so it may not have uploaded.",
    "Your resume didn't come through.",
    "Could you paste your resume straight into the message?",
    "I haven't received your CV yet.",
  ];
  for (const bad of cases) {
    it(`removes: "${bad}"`, () => {
      const g = guardResumeClaims(`${bad} The role leans senior.`, saved);
      expect(g.fixed).toBe(true);
      expect(g.text).not.toContain(bad);
      expect(g.text).toContain("The role leans senior.");
      expect(g.text.startsWith("I have your resume saved (v2, one of 2 versions on file)")).toBe(true);
    });
  }
  it("keeps sentences about what the resume says", () => {
    const ok = "Your resume doesn't mention SQL. I don't see SQL on your resume either. Lead with the dashboard line.";
    expect(guardResumeClaims(ok, saved)).toEqual({ text: ok, fixed: false, removed: [] });
  });
  it("keeps list structure", () => {
    const g = guardResumeClaims("I didn't get your resume.\n\n- Fix the summary\n- Add a metric", saved);
    expect(g.text).toBe("I have your resume saved (v2, one of 2 versions on file) and I'm using it.\n\n- Fix the summary\n- Add a metric");
  });
  it("does nothing when no resume is saved", () => {
    const ask = "Paste your resume and I'll compare it.";
    expect(guardResumeClaims(ask, { has: false, version: "v1", count: 0 }).text).toBe(ask);
  });
  it("is stable when applied again to its own output", () => {
    const once = guardResumeClaims("I don't see a resume. Next steps below.", saved).text;
    expect(guardResumeClaims(once, saved).text).toBe(once);
  });
});
