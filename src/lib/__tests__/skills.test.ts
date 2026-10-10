import { describe, expect, it } from "vitest";
import { buildDemoData, DEMO_RESUME_V2 } from "../demo";
import { familyOf, jobTypeOf } from "../insights";
import { jobTypeProfiles, yearsBand } from "../jobtypes";
import { DAY } from "../learn";
import { jobTypeCandidates, leadQuoteCandidates, learnedId, syncRules, type PlaybookRule } from "../playbook";
import { newApplication, newContact } from "../records";
import { parseCv } from "../resume";
import type { Application } from "../schemas";
import { followed, traceRules } from "../skills/catalog";
import { freezeCv, signedRules } from "../skills/freeze";
import { diffItems, personalSkillMarkdown, personalSkills, skillContext } from "../skills/personal";
import { interviewOutcome, scoreAll, scoreRule, shrink } from "../skills/score";
import { applyPlan, checkRewrite, jobOnlyTerms, rulesPlan, validatePlan, type TailorPlan } from "../tailor";
import { FILL, rulesPrep, validatePrep } from "../interview";
import { jobTypeRecos, ruleRecos, targetingSignal, type JobTypeProfile } from "../jobtypes";
import { followedRefs, memoryFromRecords, nextMilestone } from "../memory";
import { interviewReach } from "../skills/score";

const NOW = Date.UTC(2026, 9, 5);
const { applications, contacts } = buildDemoData(11, NOW);

const GOOD = `Sam Example
SUMMARY
Data analyst who builds SQL dashboards.
EXPERIENCE
- Built 12 SQL dashboards used by 4 teams
- Cut review time by 30% with Python checks
EDUCATION
Example College, 2025
SKILLS
Python, SQL`;

let n = 0;
function app(over: Partial<Parameters<typeof newApplication>[0]> = {}): Application {
  n++;
  return newApplication({ id: `t${n}`, createdAt: NOW - 40 * DAY, role: "Data Analyst", company: "Demo Co", stage: "applied", history: [{ stage: "applied", at: NOW - 40 * DAY }], appliedAt: NOW - 40 * DAY, ...over });
}
const responded = { stage: "responded" as const, history: [{ stage: "applied", at: NOW - 40 * DAY }, { stage: "responded", at: NOW - 35 * DAY }] };
const rejected = { stage: "rejected" as const, history: [{ stage: "applied", at: NOW - 40 * DAY }, { stage: "rejected", at: NOW - 30 * DAY }] };

function rule(over: Partial<PlaybookRule>): PlaybookRule {
  return { key: "k", scope: "resume", family: null, text: "Lead with SQL.", evidence: "3 of 4 vs 1 of 4.", tier: "early", status: "accepted", current: true, source: "rules", createdAt: 0, updatedAt: 0, skill: "resume-tailor", origin: "outcomes", ...over };
}

describe("resume parsing and rule checks", () => {
  it("finds headings and bullets", () => {
    const cv = parseCv(GOOD);
    expect(cv.headings).toEqual(["summary", "experience", "education", "skills"]);
    expect(cv.bullets.map((b) => b.section)).toEqual(["experience", "experience"]);
  });
  it("signs the trace: followed rules plain, broken rules with !", () => {
    const t = traceRules("cv", { cvText: GOOD, jobText: "SQL dashboards and Python" });
    expect(t).toContain("resume-bullet-writer/action-verbs");
    expect(t).toContain("resume-quantifier/numbers");
    expect(t).toContain("resume-ats-optimizer/headings");
    expect(t).toContain("!tech-resume-optimizer/projects-links");
    expect(followed(t, "resume-ats-optimizer/headings")).toBe(true);
    expect(followed(t, "tech-resume-optimizer/projects-links")).toBe(false);
    expect(followed(t, "cover-letter-generator/talking-points")).toBeNull();
  });
  it("never counts a placeholder as a number", () => {
    const t = traceRules("cv", { cvText: "EXPERIENCE\n- Built dashboards [add metric]\n- Led a project [add metric]" });
    expect(t).toContain("!resume-quantifier/numbers");
  });
});

describe("job types", () => {
  it("tells analytics engineering, analytics and product apart", () => {
    expect(jobTypeOf("Analytics Engineer II")).toBe("analytics_engineering");
    expect(jobTypeOf("Senior Data Analyst")).toBe("data_analytics");
    expect(jobTypeOf("Associate Product Manager")).toBe("product");
  });
  it("uses the user's override over the guess", () => {
    expect(familyOf({ role: "Data Analyst", jobType: "analytics_engineering" })).toBe("Analytics engineering");
    expect(familyOf({ role: "Data Analyst", jobType: null })).toBe("Data analytics");
  });
  it("buckets years required", () => {
    expect(yearsBand("3+ years of SQL")).toBe("Asks for 3+ years");
    expect(yearsBand("0-2 years experience")).toBe("Asks for 0 to 2 years");
    expect(yearsBand("No requirement")).toBe("Years not stated");
  });
  it("finds the planted dbt pattern for analytics engineering, by resume coverage", () => {
    const ae = jobTypeProfiles(applications, NOW).find((p) => p.family === "Analytics engineering")!;
    const dbt = ae.coverage.find((c) => c.term.toLowerCase() === "dbt")!;
    expect(dbt.covered.s / dbt.covered.n).toBeGreaterThan(dbt.uncovered.s / dbt.uncovered.n);
    expect(ae.commonAsks.map((a) => a.term.toLowerCase())).not.toContain("own");
  });
  it("shrinks small groups toward the prior", () => {
    expect(shrink(2, 2, 0.3)).toBeLessThan(1);
    expect(shrink(2, 2, 0.3)).toBeGreaterThan(0.3);
    expect(shrink(200, 200, 0.3)).toBeGreaterThan(0.95);
  });
});

describe("rule scoring", () => {
  const id = "resume-quantifier/numbers";
  const follows = (yes: boolean) => ({ trace: [yes ? id : `!${id}`] });
  const apps = [
    ...Array.from({ length: 4 }, () => app({ ...responded, ...follows(true) })),
    app({ ...rejected, ...follows(true) }),
    ...Array.from({ length: 4 }, () => app({ ...rejected, ...follows(false) })),
    app({ ...responded, ...follows(false) }),
  ];
  it("scores a rule from followed vs not followed outcomes", () => {
    const [all] = scoreRule(id, "cv", apps, [], NOW);
    expect(all.with).toMatchObject({ s: 4, n: 5 });
    expect(all.without).toMatchObject({ s: 1, n: 5 });
    expect(all.status).toBe("working");
    expect(all.tier).toBe("early");
  });
  it("calls a rule untested until both groups have outcomes", () => {
    const [all] = scoreRule(id, "cv", apps.filter((a) => a.trace!.includes(id)), [], NOW);
    expect(all.status).toBe("untested");
  });
  it("pulls a small job type toward the overall result", () => {
    const pm = [app({ role: "Product Manager", ...responded, ...follows(false) }), app({ role: "Product Manager", ...rejected, ...follows(true) })];
    const scores = scoreRule(id, "cv", [...apps, ...pm], [], NOW);
    const product = scores.find((s) => s.family === "Product")!;
    // Two outcomes are analysed right away, labelled as an early signal.
    expect(product.tier).toBe("early");
    // Raw rates say 0% vs 100%; shrinkage keeps the estimate far from -1.
    expect(product.lift).toBeGreaterThan(-0.6);
  });
  it("scores message rules on acceptance", () => {
    const c = (accepted: boolean, follow: boolean) =>
      newContact({ id: `c${n++}`, createdAt: NOW - 30 * DAY, firstName: "Sam", recipientType: "alum", stage: accepted ? "accepted" : "sent", history: [{ stage: "sent", at: NOW - 30 * DAY }], message: { stage: "invite_note", channel: "linkedin", opener: "role_led", chars: 120, ruleTrace: [follow ? "cold-email-writer/no-filler-close" : "!cold-email-writer/no-filler-close"] } });
    const cs = [c(true, true), c(true, true), c(true, true), c(false, false), c(false, false), c(true, false)];
    const [all] = scoreRule("cold-email-writer/no-filler-close", "message", [], cs, NOW);
    expect(all.with).toMatchObject({ s: 3, n: 3 });
    expect(all.without).toMatchObject({ s: 1, n: 3 });
  });
  it("judges interviews by reaching the final round", () => {
    expect(interviewOutcome(app({ stage: "final_round", history: [{ stage: "interview", at: 1 }, { stage: "final_round", at: 2 }] }))).toBe("success");
    expect(interviewOutcome(app({ stage: "rejected", history: [{ stage: "interview", at: 1 }, { stage: "rejected", at: 2 }] }))).toBe("failure");
    expect(interviewOutcome(app(rejected))).toBe("pending");
  });
});

describe("new rule sources", () => {
  it("turns job-type coverage into an ATS rule", () => {
    const c = jobTypeCandidates(applications, NOW).find((x) => x.key.startsWith("cover|Analytics engineering|dbt"));
    expect(c?.skill).toBe("resume-ats-optimizer");
    expect(c?.origin).toBe("job_type");
    expect(c?.evidence).toMatch(/\d+ of \d+/);
  });
  it("turns the resume line successful outreach led with into a tailoring rule", () => {
    const c = leadQuoteCandidates(applications, contacts, NOW);
    expect(c[0]?.skill).toBe("resume-tailor");
    expect(c[0]?.text).toContain("Designed SQL dashboards");
  });
  it("keeps rules from notes current when outcome counts change", () => {
    const notes = rule({ key: "notes|all|x", tier: "notes", origin: "notes" });
    expect(syncRules([notes], [], 1)[0].current).toBe(true);
    expect(syncRules([rule({ key: "gap|all|x" })], [], 1)[0].current).toBe(false);
  });
});

describe("personal skills", () => {
  const scores = scoreAll(applications, contacts, NOW);
  const rules = [rule({ key: "lead|x", text: "Keep the SQL line on top." }), rule({ key: "gap|y", status: "proposed", text: "Proposed only." })];
  const skills = personalSkills(rules, scores);
  const tailor = skills.find((s) => s.id === "resume-tailor")!;
  it("puts accepted rules in the learned layer and keeps proposed ones out", () => {
    expect(tailor.learnedMd).toContain("Keep the SQL line on top.");
    expect(tailor.learnedMd).not.toContain("Proposed only.");
    expect(tailor.proposed).toHaveLength(1);
  });
  it("records paused baseline advice with its evidence", () => {
    const paused = skills.flatMap((s) => s.paused);
    expect(paused.length).toBeGreaterThan(0);
    for (const p of paused) expect(p.score.status).toBe("not_working");
  });
  it("changes version signature only when what it learned changes", () => {
    const again = personalSkills(rules, scores).find((s) => s.id === "resume-tailor")!;
    expect(again.signature).toBe(tailor.signature);
    const more = personalSkills([...rules, rule({ key: "lead|z", text: "Another rule." })], scores).find((s) => s.id === "resume-tailor")!;
    expect(more.signature).not.toBe(tailor.signature);
    expect(diffItems(tailor.items, more.items)).toEqual(['Added learned "Another rule.", based on Early signal. 3 of 4 vs 1 of 4.']);
    const updated = personalSkills([rule({ key: "lead|x", text: "Keep the SQL line on top.", evidence: "5 of 6 vs 1 of 4." }), rules[1]], scores).find((s) => s.id === "resume-tailor")!;
    expect(diffItems(tailor.items, updated.items)).toEqual(['Updated learned "Keep the SQL line on top.": now Early signal. 5 of 6 vs 1 of 4.']);
    expect(diffItems(more.items, tailor.items)).toEqual(['Removed learned "Another rule."']);
  });
  it("exports a SKILL.md: personal layer first, baseline unchanged at the end", () => {
    const base = "---\nname: resume-tailor\ndescription: Customize resumes\n---\n\n# Resume Tailor\nBody text.";
    const md = personalSkillMarkdown(tailor, base, 3, "2026-10-05");
    expect(md.startsWith("---\nname: resume-tailor-personal\n")).toBe(true);
    expect(md).toContain("## House rules");
    expect(md.indexOf("Keep the SQL line on top.")).toBeLessThan(md.indexOf("# Resume Tailor"));
    expect(md.trimEnd().endsWith("Body text.")).toBe(true);
  });
  it("sends only accepted, current rules for this job type and action", () => {
    const ctx = skillContext({
      use: "tailor",
      family: "Data analytics",
      rules: [
        rule({ key: "a", text: "In." }),
        rule({ key: "b", text: "Other family.", family: "Product" }),
        rule({ key: "c", text: "Outreach only.", skill: "cold-email-writer", scope: "message" }),
        rule({ key: "d", text: "Paused.", current: false }),
        rule({ key: "e", text: "Proposed.", status: "proposed" }),
      ],
      scores: [],
      seed: 1,
    });
    expect(ctx.learned.map((r) => r.text)).toEqual(["In."]);
  });
  it("holds a rule back to keep testing it only when its score allows, never above the cap", () => {
    const id = learnedId("a");
    const losing = [{ id, metric: "response" as const, family: null, with: { s: 0, n: 6, ids: [] }, without: { s: 6, n: 6, ids: [] }, lift: -0.5, tier: "early" as const, status: "not_working" as const }];
    const none = skillContext({ use: "tailor", family: null, rules: [rule({ key: "a" })], scores: losing, seed: 3, exploreCap: 0 });
    expect(none.explore).toEqual([]);
    let held = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = skillContext({ use: "tailor", family: null, rules: [rule({ key: "a" })], scores: losing, seed, exploreCap: 0.2 });
      if (c.explore.length) {
        held++;
        expect(c.learned).toEqual([]);
      }
    }
    expect(held).toBeGreaterThan(0);
    expect(held / 200).toBeLessThanOrEqual(0.3);
  });
});

describe("tailoring checks", () => {
  const resume = DEMO_RESUME_V2;
  const job = "Analytics Engineer. Strong SQL and dbt. Experience with Snowflake and Airflow.";
  const jobOnly = jobOnlyTerms(resume, job, null);
  it("rejects new numbers but allows [add metric]", () => {
    expect(checkRewrite("Designed SQL dashboards used weekly by 4 operations teams", "Built SQL dashboards used by 9 teams", resume, jobOnly)).toMatch(/number/);
    expect(checkRewrite("Developed an LLM evaluation harness with 25 golden cases", "Built an LLM evaluation harness with 25 golden cases, cutting errors by [add metric]", resume, jobOnly)).toBeNull();
  });
  it("rejects job-post terms the resume never mentions", () => {
    expect(checkRewrite("Modeled 12 dbt tables for revenue reporting with stakeholders", "Modeled 12 dbt tables in Snowflake for revenue reporting", resume, jobOnly)).toMatch(/doesn't support|names something/);
  });
  it("rejects names that aren't in the resume and allows plain rewording", () => {
    expect(checkRewrite("Designed SQL dashboards used weekly by 4 operations teams", "Designed SQL dashboards for Acme used weekly by 4 operations teams", resume, jobOnly)).toMatch(/Acme/);
    expect(checkRewrite("Designed SQL dashboards used weekly by 4 operations teams", "Built SQL dashboards that 4 operations teams used weekly", resume, jobOnly)).toBeNull();
  });
  it("keeps only valid parts of a plan, with reasons for the rest", () => {
    const cv = parseCv(resume);
    const bullets = cv.bullets.map((b) => b.id);
    const plan: TailorPlan = {
      summary: { text: "Analytics engineer who models dbt tables and builds SQL dashboards.", ruleIds: ["resume-tailor/summary-match", "made-up/rule"] },
      edits: [
        { lineId: bullets[1], text: "Built SQL dashboards that 4 operations teams used weekly", ruleIds: ["resume-bullet-writer/action-verbs"], why: "" },
        { lineId: bullets[2], text: "Modeled 40 dbt tables", ruleIds: [], why: "" },
        { lineId: "l999", text: "Invented line", ruleIds: [], why: "" },
      ],
      order: [{ section: "experience", lineIds: [bullets[2], bullets[0]] }],
      talkingPoints: [{ text: "Data modeling", quote: "Modeled 12 dbt tables" }, { text: "Fake", quote: "Led a team of 50 engineers" }],
      applied: [],
    };
    const v = validatePlan(plan, { resume, jobText: job, fit: null, role: "Analytics Engineer", allowedRules: new Set(["resume-tailor/summary-match", "resume-bullet-writer/action-verbs"]) });
    expect(v.plan.summary?.ruleIds).toEqual(["resume-tailor/summary-match"]);
    expect(v.plan.edits).toHaveLength(1);
    expect(v.plan.order).toEqual([]);
    expect(v.plan.talkingPoints).toHaveLength(1);
    expect(v.rejected.map((r) => r.reason).join(" ")).toMatch(/number/);
    const out = applyPlan(resume, v.plan, null, job, v.rejected);
    expect(out.text).toContain("SUMMARY\nAnalytics engineer who models dbt tables");
    expect(out.text).toContain("- Built SQL dashboards that 4 operations teams used weekly");
    expect(out.changes.map((c) => c.kind)).toEqual(["summary", "rewrite"]);
    expect(out.missing.map((m) => m.toLowerCase())).toEqual(expect.arrayContaining(["snowflake", "airflow"]));
  });
  it("rules-only plan moves lines an accepted rule boosts", () => {
    const plan = rulesPlan(resume, null, "React front-end role", ["Developed an LLM evaluation harness"]);
    const first = plan.order[0].lineIds[0];
    expect(parseCv(resume).lines.find((l) => l.id === first)?.text).toMatch(/^Developed an LLM/);
  });
});

describe("interview prep", () => {
  it("replaces anything the resume doesn't support with [fill in]", () => {
    const v = validatePrep(
      { questions: [{ question: "q", requirement: "r", quote: "Led a team of 50", star: { situation: "At Globex we had a backlog.", task: "Fix it with SQL.", action: "I built Python checks", result: "Cut time by 40%" } }], questionsForThem: [] },
      "Built Python validation checks, cutting time by 30%",
      "SQL",
    );
    const q = v.prep.questions[0];
    expect(q.quote).toBeNull();
    expect(q.star).toEqual({ situation: FILL, task: "Fix it with SQL.", action: "I built Python checks", result: FILL });
    expect(v.fixed).toBe(3);
  });
  it("skips years-of-experience requirements and quotes only real bullets", () => {
    const fit = applications[0].fit!;
    const prep = rulesPrep({ ...fit, ratings: [{ requirement: "3+ years of SQL", evidence: "missing", resumeQuote: null, gapTag: "seniority", weight: 1 }, ...fit.ratings] }, "", DEMO_RESUME_V2);
    expect(prep.questions.some((q) => /years/.test(q.requirement))).toBe(false);
    for (const q of prep.questions) if (q.quote) expect(DEMO_RESUME_V2).toContain(q.quote);
  });
});

describe("freezing the resume that went out", () => {
  it("records the rules it followed and signs learned rules", () => {
    const a = app({ jobText: "SQL dashboards", fit: null });
    const f = freezeCv(a, GOOD, "v1", null, NOW);
    expect(f.cv?.tailored).toBe(false);
    expect(f.trace).toContain("resume-quantifier/numbers");
    const t = freezeCv(a, GOOD, "v1", { text: GOOD, rules: ["learned/x", "!learned/y"] }, NOW);
    expect(t.trace).toContain("resume-version-manager/tailored");
    expect(signedRules(["learned/a"], { family: null, learned: [{ id: "learned/a", skill: "resume-tailor", text: "", evidence: "", tier: "early", origin: "outcomes" }, { id: "learned/b", skill: "resume-tailor", text: "", evidence: "", tier: "early", origin: "outcomes" }], working: [], paused: [], explore: ["learned/c"], profile: [], chains: [], versions: {} }, null)).toEqual(["learned/a", "!learned/b", "!learned/c"]);
  });
});

describe("interviews as a second result", () => {
  it("counts reaching an interview, and closing without one", () => {
    expect(interviewReach(app({ stage: "interview", history: [{ stage: "applied", at: 1 }, { stage: "interview", at: 2 }] }), NOW)).toBe("success");
    expect(interviewReach(app(rejected), NOW)).toBe("failure");
    expect(interviewReach(app({ ...responded, history: [{ stage: "applied", at: NOW - 2 * DAY }, { stage: "responded", at: NOW - DAY }], appliedAt: NOW - 2 * DAY }), NOW)).toBe("pending");
  });
  it("scores a rule on interviews separately from responses", () => {
    const id = "resume-tailor/summary-match";
    const iv = { stage: "interview" as const, history: [{ stage: "applied", at: NOW - 40 * DAY }, { stage: "responded", at: NOW - 38 * DAY }, { stage: "interview", at: NOW - 30 * DAY }] };
    const apps = [
      ...Array.from({ length: 3 }, () => app({ ...iv, trace: [id] })),
      ...Array.from({ length: 3 }, () => app({ ...responded, stage: "rejected", history: [...responded.history, { stage: "rejected", at: NOW - 20 * DAY }], trace: [`!${id}`] })),
    ];
    const [resp] = scoreRule(id, "cv", apps, [], NOW, "response");
    const [intv] = scoreRule(id, "cv", apps, [], NOW, "interview");
    expect(resp.status).toBe("untested"); // everyone got a response
    expect(intv.with).toMatchObject({ s: 3, n: 3 });
    expect(intv.without).toMatchObject({ s: 0, n: 3 });
    expect(intv.status).toBe("working");
  });
  it("lists what went with interviews per job type", () => {
    const scores = scoreAll(applications, contacts, NOW);
    const recos = ruleRecos(scores, "Analytics engineering");
    for (const r of recos) expect(r.why).toMatch(/\d+ of \d+/);
  });
});

describe("per-post suggestions from the job type", () => {
  const profile: JobTypeProfile = {
    family: "Analytics engineering", n: 9, s: 6, rate: 6 / 9, shrunk: 0.6, ci: { low: 0.35, high: 0.88 }, tier: "early",
    commonAsks: [], posts: [], ids: [],
    coverage: [{ term: "dbt", covered: { s: 6, n: 7, ids: [] }, uncovered: { s: 0, n: 2, ids: [] }, lift: 0.86, tier: "early" }],
  };
  it("matches the post against your current resume", () => {
    const shown = jobTypeRecos(profile, { jobText: "We use dbt and SQL", fit: null, resume: "Modeled 12 dbt tables" }, 0.4);
    expect(shown[0].advice).toMatch(/^Keep "dbt"/);
    expect(shown[0].why).toContain("6 of 7");
    const missing = jobTypeRecos(profile, { jobText: "We use dbt and SQL", fit: null, resume: "Built SQL dashboards" }, 0.4);
    expect(missing[0].advice).toMatch(/doesn't show it/);
    expect(missing[0].why).toMatch(/only where it's true/);
    expect(jobTypeRecos(profile, { jobText: "Python only", fit: null, resume: "" }, 0.4).some((r) => r.id.startsWith("jt-cover"))).toBe(false);
  });
  it("says apply more or less only when the range clears your overall rate", () => {
    expect(targetingSignal(profile, 0.3)).toBe("apply_more");
    expect(targetingSignal(profile, 0.5)).toBe("unclear");
    expect(targetingSignal({ ...profile, ci: { low: 0.02, high: 0.2 } }, 0.4)).toBe("apply_less");
  });
});

describe("memory log", () => {
  it("records sends, interviews and outcomes with the insights that were on the resume", () => {
    const entries = memoryFromRecords(applications, familyOf, (id) => id);
    const iv = entries.find((e) => e.kind === "interview")!;
    expect(iv.refs.every((r) => !r.startsWith("!"))).toBe(true);
    expect(iv.detail.split("\n").length).toBe(iv.refs.length);
    expect(entries.filter((e) => e.kind === "outcome" && e.detail.includes("What I'd change")).length).toBeGreaterThan(0);
  });
  it("keeps only followed rules and knows the next milestone", () => {
    expect(followedRefs(["a", "!b", "c"])).toEqual(["a", "c"]);
    expect(nextMilestone(48)?.at).toBe(50);
    expect(nextMilestone(600)).toBeNull();
  });
});
