/**
 * Regressions from a real session (synthetic text): a pasted rejection email
 * was treated as a LinkedIn profile ("Hi The,", shared ground "Thank"), a job
 * post's first sentence became the role title, and the chat could not see the
 * saved resume.
 */
import { describe, expect, it } from "vitest";
import { classifyDocument, extractJobMeta, extractRecipientMeta, ROLE_UNKNOWN } from "../classify";
import { detectSharedGround } from "../shared";
import { rulesDraft, templateDraft, renderDraft } from "../draft";
import { buildChatRequest, CONTEXT_MAX, RESUME_MAX } from "../chat";
import { BACKGROUND, JOB, RECIPIENT, RESUME } from "../samples";

const REJECTION = `Hi Sam,

Thank you for your interest in the Policy Analyst position at Acme Health and for taking the time to apply.

After careful review, we have decided to move forward with other candidates whose experience more closely matches our needs at this time.

We encourage you to follow our careers page and apply for future roles.

Best regards,
The Talent Acquisition Team`;

const ME = `Sam Rivera
Princeton, NJ

Thank you notes: volunteer coordinator

EDUCATION
State University, B.S. Public Health, May 2025

EXPERIENCE
Policy Intern, County Health Dept   Jun 2024 - Aug 2024
- Built a dashboard tracking Medicaid enrollment`;

const SENTENCE_JD = `This role sits at the intersection of US health policy and life sciences commercialization.
You will support market access strategy for new therapies.
Requirements: 2+ years experience in policy research.`;

describe("rejection emails", () => {
  it("classifies as an email, not a LinkedIn profile", () => {
    const c = classifyDocument(REJECTION);
    expect(c.kind).toBe("message");
    expect(c.ambiguous).toBe(false);
  });

  it("never takes a sign-off line as the person's name", () => {
    expect(extractRecipientMeta(REJECTION, false).firstName).not.toBe("The");
    expect(extractRecipientMeta("Thanks Again\nRecruiter at Acme", false).firstName).toBeNull();
  });

  it("does not offer 'Thank' as shared ground", () => {
    const labels = detectSharedGround(ME, REJECTION).map((s) => s.label);
    expect(labels).not.toContain("Thank");
  });
});

describe("ambiguity guard", () => {
  it("leaves the clear sample documents alone", () => {
    // BACKGROUND is excluded: the sample flow always sends it with an explicit label.
    for (const doc of [JOB, RESUME, RECIPIENT]) expect(classifyDocument(doc).ambiguous).toBe(false);
  });

  it("asks rather than overwriting the saved background with an unlabelled short text", () => {
    expect(classifyDocument(BACKGROUND).ambiguous).toBe(true);
  });

  it("asks when nothing scores clearly", () => {
    expect(classifyDocument("one\ntwo\nthree\nfour\nfive\nsix lines").ambiguous).toBe(true);
  });
});

describe("role title fallback", () => {
  it("never uses a sentence as the role", () => {
    expect(extractJobMeta(SENTENCE_JD).role).toBe(ROLE_UNKNOWN);
  });

  it("finds 'the X position' in prose", () => {
    expect(extractJobMeta(`We are hiring.\nJoin the Policy Analyst position team.\nYou will research.`).role).toBe("Policy Analyst");
  });

  it("still reads a normal title line", () => {
    expect(extractJobMeta(JOB).role).not.toBe(ROLE_UNKNOWN);
  });

  it("renders the unknown role naturally in drafts", () => {
    const ctx = { stage: "invite_note", channel: "email", recipientType: "team_member", recipientFirstName: "Sam", myName: "Alex Doe", role: ROLE_UNKNOWN, company: "Acme", shared: [], fit: null, premium: false } as const;
    for (const d of [rulesDraft({ ...ctx, shared: [] }), templateDraft({ ...ctx, shared: [] })]) {
      const text = renderDraft(d, { includeSubject: true });
      expect(text).toContain("the open role");
      expect(text).not.toMatch(/role role|the the/);
      expect(d.subject).toMatch(/^Open role/);
    }
  });
});

describe("buildChatRequest", () => {
  const paste = (docKind: string, text: string) => ({ role: "user" as const, kind: "paste", text, payload: { docKind, chars: text.length } });

  it("puts the saved resume in context", () => {
    const r = buildChatRequest({ messages: [{ role: "user", kind: "text", text: "why was I rejected?" }], text: "why was I rejected?", profile: { resume: ME, background: "" }, app: null });
    expect(r.context).toContain("The user's saved resume");
    expect(r.context).toContain("Built a dashboard tracking Medicaid enrollment");
  });

  it("says plainly when no resume is saved", () => {
    const r = buildChatRequest({ messages: [], text: "hi", profile: { resume: "", background: "" }, app: null });
    expect(r.context).toContain("has not saved a resume");
    expect(r.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("shows pasted documents in history instead of dropping them", () => {
    const r = buildChatRequest({
      messages: [paste("resume", ME), { role: "assistant", kind: "profile" }, paste("message", REJECTION), { role: "user", kind: "text", text: "where did I go wrong?" }],
      text: "where did I go wrong?",
      profile: { resume: ME, background: "" },
      app: null,
    });
    expect(r.messages).toHaveLength(1);
    const content = r.messages[0].content;
    expect(content).toContain("[Pasted resume (saved to profile)");
    expect(content).toContain("<pasted_email>");
    expect(content).toContain("move forward with other candidates");
    expect(content).toContain("where did I go wrong?");
  });

  it("alternates roles, starts with the user, and stays within limits", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", kind: "text", text: `m${i}` }));
    const r = buildChatRequest({ messages: many, text: "next", profile: { resume: "x".repeat(RESUME_MAX * 2), background: "b".repeat(5000) }, app: { role: "Analyst", company: "Acme", fit: { score: 60, gaps: ["seniority"] }, jobText: "j".repeat(20000) } });
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[r.messages.length - 1].role).toBe("user");
    expect(r.messages.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < r.messages.length; i++) expect(r.messages[i].role).not.toBe(r.messages[i - 1].role);
    for (const m of r.messages) expect(m.content.length).toBeLessThanOrEqual(4000);
    expect(r.context.length).toBeLessThanOrEqual(CONTEXT_MAX);
    expect(r.context).toContain("Fit score 60");
  });
});
