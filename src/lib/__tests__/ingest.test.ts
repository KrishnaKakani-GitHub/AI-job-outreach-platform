/**
 * Save once, analyse immediately: a resume is kept (and versioned) the first
 * time it's pasted, recovered if it was mislabelled, and analysis starts from
 * the first piece of data instead of after 5 / 15 / 30 outcomes.
 */
import { describe, expect, it } from "vitest";
import { classifyDocument, isStrongResume } from "../classify";
import { findResumeInHistory, nextResumeVersion } from "../ingest";
import { craftApplication, DAY, tierProgress } from "../learn";
import { newApplication } from "../records";
import type { Application } from "../schemas";
import { JOB, RECIPIENT, RESUME } from "../samples";

const NOW = Date.UTC(2026, 9, 10);

/** A resume copied out of a PDF: no section headers survive, but contact details and dates do. */
const PDF_RESUME = `Sam Rivera  sam.rivera@example.com  (555) 010-2030  linkedin.com/in/sam-rivera-demo
State University  B.S. Public Health  May 2025
County Health Dept  Policy Intern  Jun 2024 - Aug 2024
Built a dashboard tracking Medicaid enrollment across 12 counties
Analyzed survey data for a community health needs assessment
Wrote two policy briefs on access to primary care in rural areas`;

const JD_WITH_EMAIL = `Policy Analyst
About Acme Health
Responsibilities
- Research federal and state health policy
Qualifications
- Bachelor's degree; 2+ years experience
- Built or developed policy models
Skills
Send questions to careers@acmehealth.example or call (555) 010-9999.
Benefits include hybrid work.`;

function app(over: Partial<Parameters<typeof newApplication>[0]> = {}): Application {
  return newApplication({ id: Math.random().toString(36).slice(2), createdAt: NOW - 30 * DAY, role: "Policy Analyst", company: "Acme", stage: "applied", history: [{ stage: "saved", at: NOW - 30 * DAY }, { stage: "applied", at: NOW - 30 * DAY }], appliedAt: NOW - 30 * DAY, ...over });
}

describe("resume detection never bounces a resume", () => {
  it("files a header-less PDF resume as a resume", () => {
    const c = classifyDocument(PDF_RESUME);
    expect(c.kind).toBe("resume");
    expect(c.ambiguous).toBe(false);
  });
  it("does not mistake a job post with a contact email for a resume", () => {
    expect(isStrongResume(JD_WITH_EMAIL, classifyDocument(JD_WITH_EMAIL).scores)).toBe(false);
    expect(classifyDocument(JD_WITH_EMAIL).kind).toBe("job_description");
  });
  it("keeps the sample documents' labels", () => {
    expect(classifyDocument(JOB).kind).toBe("job_description");
    expect(classifyDocument(RESUME).kind).toBe("resume");
    expect(classifyDocument(RECIPIENT).kind).toBe("recipient_profile");
  });
});

describe("nextResumeVersion", () => {
  it("keeps the label for the first resume or the same text", () => {
    expect(nextResumeVersion("v1", "", PDF_RESUME)).toBe("v1");
    expect(nextResumeVersion("v3", PDF_RESUME, `  ${PDF_RESUME.replace(/\n/g, "\n\n")} `)).toBe("v3");
  });
  it("bumps the label when a different resume is saved", () => {
    expect(nextResumeVersion("v1", PDF_RESUME, RESUME)).toBe("v2");
    expect(nextResumeVersion("v9", PDF_RESUME, RESUME)).toBe("v10");
    expect(nextResumeVersion("fall-2026", PDF_RESUME, RESUME)).toBe("fall-2026-2");
    expect(nextResumeVersion("fall-2026-2", PDF_RESUME, RESUME)).toBe("fall-2026-3");
    expect(nextResumeVersion("", PDF_RESUME, RESUME)).toBe("v2");
  });
});

describe("findResumeInHistory", () => {
  const paste = (docKind: string, text: string) => ({ role: "user" as const, kind: "paste", text, payload: { docKind, chars: text.length } });
  it("recovers a resume that was left unlabelled", () => {
    expect(findResumeInHistory([paste("other", PDF_RESUME), { role: "user", kind: "text", text: "i sent u my resume!" }])).toBe(PDF_RESUME);
  });
  it("prefers the most recent resume-like paste", () => {
    expect(findResumeInHistory([paste("other", PDF_RESUME), paste("other", RESUME)])).toBe(RESUME);
  });
  it("ignores job posts, profiles and short text", () => {
    expect(findResumeInHistory([paste("job_description", JOB), paste("recipient_profile", RECIPIENT), paste("other", "short")])).toBeNull();
    expect(findResumeInHistory([])).toBeNull();
  });
});

describe("analysis starts immediately", () => {
  it("is personal after a single outcome", () => {
    const one = [app({ stage: "rejected" })];
    expect(tierProgress(one, NOW).tier).toBe("early");
  });
  it("crafts personal suggestions from the first resolved application", () => {
    const history = [app({ stage: "rejected", resumeVersion: "v1" }), app({ stage: "responded", resumeVersion: "v2", history: [{ stage: "applied", at: NOW - 30 * DAY }, { stage: "responded", at: NOW - 20 * DAY }] })];
    const craft = craftApplication({ targetId: null, role: "Policy Analyst", seniority: "entry", fit: null, jobText: JOB, resume: PDF_RESUME, apps: history, contacts: [], now: NOW });
    expect(craft.scope).not.toBe("none");
    expect(craft.pool.successes + craft.pool.failures).toBe(2);
    const resume = craft.recos.find((r) => r.kind === "resume");
    expect(resume?.advice).toBe("Use resume v2");
    expect(resume?.tier).toBe("early");
  });
  it("still gives job-post analysis with no history at all", () => {
    const craft = craftApplication({ targetId: null, role: "Policy Analyst", seniority: "entry", fit: null, jobText: JOB, resume: "", apps: [], contacts: [], now: NOW });
    expect(craft.progress.tier).toBe("job_post");
    expect(craft.scope).toBe("none");
  });
});
