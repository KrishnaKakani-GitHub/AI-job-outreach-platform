import { describe, expect, it } from "vitest";
import { buildDemoData } from "../demo";
import {
  appOutcome,
  bestContrast,
  chooseOpener,
  comparisonTier,
  craftApplication,
  DAY,
  draftGuidance,
  feasibleOpeners,
  groupBy,
  historyTier,
  jdPatterns,
  messageOutcome,
  outreachChains,
  resolvedApps,
  similarity,
  tierProgress,
} from "../learn";
import { activeRules, ruleCandidates, syncRules, type PlaybookRule } from "../playbook";
import { newApplication, newContact } from "../records";
import type { Application } from "../schemas";

const NOW = Date.UTC(2026, 9, 5);
const { applications, contacts } = buildDemoData(11, NOW);

function app(over: Partial<Parameters<typeof newApplication>[0]> = {}): Application {
  return newApplication({ id: Math.random().toString(36).slice(2), createdAt: NOW - 30 * DAY, role: "Data Analyst", company: "Demo Co", stage: "applied", history: [{ stage: "saved", at: NOW - 30 * DAY }, { stage: "applied", at: NOW - 30 * DAY }], appliedAt: NOW - 30 * DAY, ...over });
}

describe("outcomes", () => {
  it("counts any response as success, even if later rejected", () => {
    expect(appOutcome(app({ stage: "rejected", history: [{ stage: "applied", at: 1 }, { stage: "interview", at: 2 }, { stage: "rejected", at: 3 }] }), NOW)).toBe("success");
  });
  it("counts rejection without response, or 21+ days of silence, as failure", () => {
    expect(appOutcome(app({ stage: "rejected" }), NOW)).toBe("failure");
    expect(appOutcome(app({ appliedAt: NOW - 22 * DAY }), NOW)).toBe("failure");
    expect(appOutcome(app({ appliedAt: NOW - 10 * DAY }), NOW)).toBe("pending");
  });
  it("ignores saved and withdrawn-without-response applications", () => {
    expect(appOutcome(app({ stage: "saved", appliedAt: null }), NOW)).toBe("pending");
    expect(appOutcome(app({ stage: "withdrawn" }), NOW)).toBe("pending");
  });
  it("resolves messages: accepted = success, 14 days silent = failure", () => {
    const base = { id: "c", createdAt: NOW - 20 * DAY, firstName: "Sam", recipientType: "alum" as const };
    expect(messageOutcome(newContact({ ...base, stage: "accepted" }), NOW)).toBe("success");
    expect(messageOutcome(newContact({ ...base, stage: "sent", history: [{ stage: "sent", at: NOW - 15 * DAY }] }), NOW)).toBe("failure");
    expect(messageOutcome(newContact({ ...base, stage: "sent", history: [{ stage: "sent", at: NOW - 3 * DAY }] }), NOW)).toBe("pending");
  });
});

describe("evidence tiers (1 / 15 / 30)", () => {
  it("starts personal analysis at the first outcome; Pattern needs 15 with both kinds", () => {
    expect(historyTier(0, 0)).toBe("job_post");
    expect(historyTier(1, 0)).toBe("early");
    expect(historyTier(0, 1)).toBe("early");
    expect(historyTier(2, 2)).toBe("early");
    expect(historyTier(15, 0)).toBe("early");
    expect(historyTier(0, 20)).toBe("early");
    expect(historyTier(3, 11)).toBe("early");
    expect(historyTier(3, 12)).toBe("pattern");
  });
  it("calls a comparison strong only with 30 in each group", () => {
    expect(comparisonTier(4, 4)).toBe("early");
    expect(comparisonTier(10, 5)).toBe("pattern");
    expect(comparisonTier(30, 29)).toBe("pattern");
    expect(comparisonTier(30, 30)).toBe("strong");
  });
  it("is live after one outcome and explains what firms it up", () => {
    expect(tierProgress([], NOW).tier).toBe("job_post");
    expect(tierProgress([], NOW).next).toMatch(/first outcome/);
    const p = tierProgress([app({ stage: "rejected" })], NOW);
    expect(p.tier).toBe("early");
    expect(p.next).toMatch(/14 more outcomes/);
    expect(p.next).toMatch(/gets a response/);
  });
});

describe("comparisons", () => {
  it("finds the level that beats the rest", () => {
    const rs = [
      ...Array.from({ length: 4 }, (_, i) => ({ app: app({ id: `a${i}`, resumeVersion: "v2" }), outcome: (i < 3 ? "success" : "failure") as "success" | "failure" })),
      ...Array.from({ length: 4 }, (_, i) => ({ app: app({ id: `b${i}`, resumeVersion: "v1" }), outcome: (i < 1 ? "success" : "failure") as "success" | "failure" })),
    ];
    const c = bestContrast(groupBy(rs, (r) => r.app.resumeVersion))!;
    expect(c.best.level).toBe("v2");
    expect(c.best.s).toBe(3);
    expect(c.rest).toEqual({ s: 1, n: 4, rate: 0.25 });
    expect(c.tier).toBe("early");
  });
  it("returns null when nothing outperforms", () => {
    expect(bestContrast(groupBy([{ app: app(), outcome: "success" }], () => "x"))).toBeNull();
  });
});

describe("similarity", () => {
  it("ranks same family and overlapping requirements highest", () => {
    const t = { role: "Senior Data Analyst", seniority: "entry", fit: null, jobText: "SQL dashboards stakeholders" };
    const same = app({ role: "Data Analyst", seniority: "entry", jobText: "SQL dashboards for stakeholders" });
    const other = app({ role: "Product Manager", seniority: "senior", jobText: "roadmaps and design partners" });
    expect(similarity(t, same)).toBeGreaterThan(similarity(t, other));
    expect(similarity(t, same)).toBeGreaterThanOrEqual(0.65);
  });
});

describe("opener bandit", () => {
  const stats = [
    { key: "shared_school", s: 9, n: 10 },
    { key: "role_led", s: 1, n: 10 },
  ];
  it("only picks openers that are possible for this recipient", () => {
    expect(feasibleOpeners([])).toEqual(["role_led"]);
    expect(chooseOpener(stats, ["role_led"], 1)!.opener).toBe("role_led");
  });
  it("usually exploits the best arm but still explores", () => {
    let school = 0;
    let explored = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const c = chooseOpener(stats, ["role_led", "shared_school"], seed)!;
      if (c.opener === "shared_school") school++;
      if (c.exploring) explored++;
    }
    expect(school / 400).toBeGreaterThan(0.9);
    expect(explored).toBeGreaterThan(0);
  });
  it("is reproducible for a seed", () => {
    expect(chooseOpener(stats, ["role_led", "shared_school"], 42)).toEqual(chooseOpener(stats, ["role_led", "shared_school"], 42));
  });
  it("gives guidance from the first resolved message", () => {
    expect(draftGuidance([], ["school"], NOW, 1)).toBeNull();
    expect(draftGuidance(contacts.slice(0, 2), ["school"], NOW, 1)).not.toBeNull();
    const g = draftGuidance(contacts, ["school"], NOW, 1);
    expect(g).not.toBeNull();
    expect(["role_led", "shared_school"]).toContain(g!.opener);
    expect(g!.why).toMatch(/\d+ of \d+/);
  });
});

describe("demo data contains the planted patterns", () => {
  it("reaches the pattern tier", () => {
    expect(tierProgress(applications, NOW).tier).toBe("pattern");
  });
  it("finds job-post terms and outreach chains", () => {
    expect(jdPatterns(resolvedApps(applications, NOW)).length).toBeGreaterThan(0);
    const chains = outreachChains(applications, contacts, NOW);
    expect(chains.length).toBeGreaterThan(0);
    expect(chains[0].steps[0]).toMatch(/opener/);
  });
});

describe("craft this application", () => {
  const target = applications.find((a) => a.stage === "saved" && /Analyst/.test(a.role))!;
  it("starts from the job post alone with no history", () => {
    const c = craftApplication({ targetId: target.id, role: target.role, seniority: target.seniority, fit: target.fit, jobText: target.jobText, resume: "", apps: [target], contacts: [], now: NOW });
    expect(c.progress.tier).toBe("job_post");
    expect(c.recos.every((r) => r.tier === "job_post")).toBe(true);
    expect(c.recos.some((r) => r.kind === "gap" || r.kind === "lead" || r.kind === "language")).toBe(true);
  });
  it("adds personal, justified suggestions with history", () => {
    const c = craftApplication({ targetId: target.id, role: target.role, seniority: target.seniority, fit: target.fit, jobText: target.jobText, resume: "", apps: applications, contacts, now: NOW, rules: [{ id: "r1", text: "Apply with resume v2.", tier: "early" }] });
    expect(c.progress.tier).not.toBe("job_post");
    const personal = c.recos.filter((r) => r.tier !== "job_post");
    expect(personal.length).toBeGreaterThan(1);
    for (const r of personal) if (r.kind !== "rule") expect(r.why).toMatch(/\d+ of \d+/);
    expect(c.recos[0].kind).toBe("rule");
  });
  it("never cites an application that isn't in the records", () => {
    const ids = new Set(applications.map((a) => a.id));
    const c = craftApplication({ targetId: target.id, role: target.role, seniority: target.seniority, fit: target.fit, jobText: target.jobText, resume: "", apps: applications, contacts, now: NOW });
    for (const r of c.recos) for (const e of r.evidence) expect(ids.has(e.id)).toBe(true);
  });
});

describe("playbook", () => {
  const cands = ruleCandidates(applications, contacts, NOW);
  it("proposes evidence-backed rules from demo data", () => {
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) expect(c.evidence).toMatch(/\d+ of \d+/);
    expect(new Set(cands.map((c) => c.key)).size).toBe(cands.length);
  });
  it("proposes nothing without outcomes, and rules as soon as a contrast exists", () => {
    expect(ruleCandidates([], [], NOW)).toEqual([]);
    const pending = applications.filter((a) => a.stage === "saved");
    expect(ruleCandidates(pending, [], NOW)).toEqual([]);
    for (const c of ruleCandidates(applications.slice(0, 6), contacts, NOW)) expect(c.evidence).toMatch(/\d+ of \d+/);
  });
  it("keeps the user's decisions when data changes, and pauses unsupported rules", () => {
    const first = syncRules([], cands, 1);
    const accepted: PlaybookRule[] = first.map((r, i) => (i === 0 ? { ...r, status: "accepted" } : r));
    const again = syncRules(accepted, cands.slice(1), 2);
    const kept = again.find((r) => r.key === cands[0].key)!;
    expect(kept.status).toBe("accepted");
    expect(kept.current).toBe(false);
    expect(activeRules(again, ["resume", "targeting", "message"], null).some((r) => r.key === cands[0].key)).toBe(false);
  });
  it("resets AI wording when the evidence behind it changes", () => {
    const stored = syncRules([], cands.slice(0, 1), 1).map((r) => ({ ...r, text: "AI words with 3 of 4", source: "ai" as const }));
    const changed = syncRules(stored, [{ ...cands[0], evidence: "new: 9 of 10" }], 2)[0];
    expect(changed.source).toBe("rules");
    expect(changed.text).toBe(cands[0].text);
  });
});
