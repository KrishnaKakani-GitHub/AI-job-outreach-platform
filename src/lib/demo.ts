/**
 * Demo mode: clearly labeled synthetic data so reviewers can see Insights,
 * the learning loop and next steps without a real search history. Every
 * record has demo: true and is never mixed into real metrics or sent to the
 * server. The generator plants deliberate patterns (e.g. alumni outreach and
 * resume v2 help data roles; product roles rarely convert) so the learning
 * features have something true to find.
 */
import type { AppSource, AppStage, Application, CompanyType, Contact, ContactStage, GapTag, MessageFeatures, Opener, ReasonCategory, ReasonSource, RecipientType, Seniority } from "./schemas";
import { traceRules } from "./skills/catalog";
import { computeScore } from "./fit";
import { newApplication, newContact } from "./records";
import { mulberry32 } from "./stats";

export const DEMO_RESUME = `Alex Demo (synthetic profile)
EDUCATION
Lakeshore College, B.S. Computer Science, 2025
EXPERIENCE
- Built Python validation checks for 100,000+ records, cutting manual review time by 30%
- Designed SQL dashboards for the operations team
- Partnered with stakeholders to define accuracy requirements
- Developed an LLM evaluation harness with 25 golden cases
- Built a React experiment dashboard with live A/B assignment`;

/** Version 2 of the synthetic resume: more numbers, a data-modeling line, standard sections. */
export const DEMO_RESUME_V2 = `Alex Demo (synthetic profile)
EDUCATION
Lakeshore College, B.S. Computer Science, 2025
EXPERIENCE
- Built Python validation checks for 100,000+ records, cutting manual review time by 30%
- Designed SQL dashboards used weekly by 4 operations teams
- Modeled 12 dbt tables for revenue reporting with stakeholders
- Developed an LLM evaluation harness with 25 golden cases
- Built a React experiment dashboard with live A/B assignment
SKILLS
Python, SQL, dbt, React, TypeScript`;

const SUMMARY: Record<string, string> = {
  "Data Analyst": "Data analyst who builds SQL dashboards and Python checks for stakeholders.",
  "Analytics Engineer": "Analytics engineer who models dbt tables and builds SQL pipelines.",
  "Product Manager, New Grad": "Builder who ships experiment dashboards and works with stakeholders.",
  "AI Engineer": "Engineer who builds LLM evaluation harnesses in Python.",
  "Growth Engineer": "Engineer who ships React experiment dashboards with A/B assignment.",
  "Senior Data Scientist": "Data practitioner who builds Python validation and evaluation tooling.",
};

/** A tailored copy: summary first, most relevant bullets first. Synthetic, like everything here. */
function tailoredDemo(base: string, role: string): string {
  const lines = base.split("\n");
  const name = lines[0];
  const rest = lines.slice(1);
  const bullets = rest.filter((l) => l.startsWith("- "));
  const words = role.toLowerCase().split(/\W+/);
  const score = (l: string) => words.filter((w) => w.length > 3 && l.toLowerCase().includes(w.slice(0, 5))).length + (/sql|dbt|python/i.test(l) && /data|analy/i.test(role) ? 2 : 0);
  const ranked = [...bullets].sort((a, b) => score(b) - score(a));
  let k = 0;
  const body = rest.map((l) => (l.startsWith("- ") ? ranked[k++] : l));
  const skills = body.some((l) => l === "SKILLS") ? [] : ["SKILLS", "Python, SQL, React"];
  return [name, "SUMMARY", SUMMARY[role] ?? "Early-career builder.", ...body, ...skills].join("\n");
}

const NOTES: { notes: string; learning: string; families: RegExp }[] = [
  { notes: "Recruiter said the team wanted hands-on dbt modeling.", learning: "For analytics engineering roles, lead with my dbt modeling work.", families: /Analytics|Data Analyst/ },
  { notes: "Interviewer asked for a product teardown and I didn't have one ready.", learning: "Prepare one product teardown story before product interviews.", families: /Product/ },
  { notes: "Rejection email mentioned more experience with experiments.", learning: "Put the A/B testing dashboard in my top three bullets for growth roles.", families: /Growth|Data Analyst/ },
  { notes: "No feedback, but the post asked for 5+ years.", learning: "Skip posts asking for 5+ years of experience.", families: /Senior/ },
];

interface Family {
  role: string;
  seniority: Seniority;
  companyType: CompanyType;
  base: number;
  reqs: [string, GapTag][];
}

const FAMILIES: Family[] = [
  {
    role: "Data Analyst",
    seniority: "entry",
    companyType: "enterprise",
    base: 0.2,
    reqs: [["Strong SQL and Python", "tooling"], ["Build dashboards for business stakeholders", "requirement_evidence"], ["Run and analyze A/B tests", "quantified_impact"], ["Communicate insights clearly", "requirement_evidence"], ["Healthcare or fintech domain experience", "domain_visibility"]],
  },
  {
    role: "Analytics Engineer",
    seniority: "entry",
    companyType: "startup",
    base: 0.32,
    reqs: [["Strong SQL and dbt", "tooling"], ["Own data models end-to-end", "ownership"], ["Build reliable data pipelines", "requirement_evidence"], ["Define metrics with stakeholders", "quantified_impact"], ["Experience with Snowflake", "tooling"]],
  },
  {
    role: "Product Manager, New Grad",
    seniority: "entry",
    companyType: "growth",
    base: 0.06,
    reqs: [["Own product decisions end-to-end", "ownership"], ["Write clear product requirements", "requirement_evidence"], ["Use metrics to prioritize", "quantified_impact"], ["Work with engineering and design", "requirement_evidence"], ["Product sense and customer empathy", "domain_visibility"]],
  },
  {
    role: "AI Engineer",
    seniority: "entry",
    companyType: "startup",
    base: 0.2,
    reqs: [["Build LLM applications in Python", "tooling"], ["Design evaluation for model quality", "quantified_impact"], ["Ship features end-to-end", "ownership"], ["Experience with React and TypeScript", "tooling"], ["Healthcare domain experience", "domain_visibility"]],
  },
  {
    role: "Growth Engineer",
    seniority: "entry",
    companyType: "startup",
    base: 0.22,
    reqs: [["Ship front-end features in React", "tooling"], ["Run experiments and A/B tests", "quantified_impact"], ["Own growth projects end-to-end", "ownership"], ["Strong SQL for funnel analysis", "tooling"], ["Communicate with cross-functional stakeholders", "requirement_evidence"]],
  },
  {
    role: "Senior Data Scientist",
    seniority: "senior",
    companyType: "enterprise",
    base: 0.02,
    reqs: [["5+ years of experience", "seniority"], ["Statistical modeling", "tooling"], ["Lead projects independently", "ownership"], ["Run and analyze A/B tests", "quantified_impact"], ["Mentor junior analysts", "seniority"]],
  },
];

const COMPANIES = ["Demo Co", "Sample Labs", "Example Health", "Placeholder AI", "Fictional Fintech", "Mock Media", "Synthetic Systems", "Test Pilot", "Imaginary Insurance", "Pretend Pay"];
const FIRST = ["Sam", "Priya", "Jordan", "Lee", "Morgan", "Avery", "Riley", "Casey"];
const LAST = ["Example", "Sample", "Demo", "Test"];
const REASONS: [ReasonCategory, ReasonSource][] = [
  ["none_given", "none"],
  ["other_candidates", "rejection_email"],
  ["experience_level", "recruiter"],
  ["skills_gap", "my_guess"],
  ["position_filled", "rejection_email"],
  ["domain", "interviewer_feedback"],
];

const DAY = 86_400_000;
const DEMO_APPS = 54;
const LEAD_SQL = "Designed SQL dashboards for the operations team";
const LEADS = ["Built a React experiment dashboard with live A/B assignment", "Developed an LLM evaluation harness with 25 golden cases", LEAD_SQL];

function demoMessage(opener: Opener, chars: number, editRatio: number, copiedAt: number, lead: string): MessageFeatures {
  const text = `Hi Sam, ${"I am reaching out about the role. ".repeat(10)}`.slice(0, chars);
  const hasClaim = opener !== "template" && opener !== "role_led";
  return {
    stage: "invite_note",
    channel: "linkedin",
    opener,
    chars,
    editRatio,
    copiedAt,
    ruleTrace: opener === "template" ? [] : traceRules("message", { message: { text, channel: "linkedin", stage: "invite_note", hasClaim } }),
    leadQuote: opener === "template" ? null : lead,
  };
}

export function buildDemoData(seed = 11, now = Date.now()): { applications: Application[]; contacts: Contact[] } {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const apps: Application[] = [];
  const contacts: Contact[] = [];

  for (let i = 0; i < DEMO_APPS; i++) {
    const fam = FAMILIES[i % FAMILIES.length];
    const createdAt = now - (DEMO_APPS * 2 + 8 - i * 2) * DAY;
    const isData = /Analyst|Analytics/.test(fam.role);
    const resumeVersion = i < DEMO_APPS * 0.4 ? "v1" : "v2";
    const ratings = fam.reqs.map(([requirement, tag]) => {
      const roll = rng() + (isData && resumeVersion === "v2" ? 0.2 : 0) + (fam.seniority === "senior" && tag === "seniority" ? -0.7 : 0);
      const evidence = roll > 0.62 ? "strong" : roll > 0.32 ? "partial" : "missing";
      const quote = evidence === "missing" ? null : (DEMO_RESUME.split("\n").filter((l) => l.startsWith("- "))[Math.floor(rng() * 5)]?.slice(2) ?? null);
      return { requirement, evidence: evidence as "strong" | "partial" | "missing", resumeQuote: quote, gapTag: evidence === "strong" ? null : tag, weight: 1 };
    });
    const score = computeScore(ratings);
    const gaps = [...new Set(ratings.filter((r) => r.gapTag).map((r) => r.gapTag!))];
    if (i % 3 === 0 && !gaps.includes("quantified_impact")) gaps.push("quantified_impact");

    const company = COMPANIES[i % COMPANIES.length];
    const saved = i >= DEMO_APPS - FAMILIES.length;
    const source: AppSource = rng() < 0.1 ? "referral" : rng() < 0.15 ? "recruiter" : "cold";
    const recipientType = pick<RecipientType>(["alum", "alum", "recruiter", "hiring_manager", "team_member"]);
    const opener = pick<Opener>(["shared_school", "role_led", "template", "shared_school", "shared_field"]);
    const networked = !saved && i % 4 !== 3;

    // Planted pattern: alumni + shared-school openers get accepted; accepted outreach helps.
    const accept = networked && rng() < (opener === "shared_school" ? 0.78 : opener === "template" ? 0.3 : 0.42) + (recipientType === "alum" ? 0.12 : 0);
    const referred = accept && recipientType === "alum" && rng() < 0.55;
    let p = fam.base + (isData && resumeVersion === "v2" ? 0.25 : 0) + (source === "referral" || referred ? 0.3 : 0) + (accept ? 0.1 : 0);
    if (fam.role.startsWith("Product")) p = Math.min(p, 0.12);
    // Planted: tailored resumes help data roles; interview prep helps reach the final round.
    const tailored = !saved && rng() < 0.5;
    if (tailored && isData) p += 0.12;
    // Planted: outreach that leads with the SQL dashboards line goes further for data roles.
    const lead = isData && (accept || rng() < 0.5) ? LEAD_SQL : pick(LEADS.slice(0, 2));
    if (networked && lead === LEAD_SQL) p += 0.15;
    const baseResume = resumeVersion === "v2" ? DEMO_RESUME_V2 : DEMO_RESUME;
    const cvText = tailored ? tailoredDemo(baseResume, fam.role) : baseResume;
    // Planted: analytics engineering posts ask for dbt; showing it on the resume is what matters.
    if (fam.role === "Analytics Engineer") p += /dbt/.test(cvText) ? 0.3 : -0.15;
    const prepped = rng() < 0.5;
    const appliedAt = saved ? null : createdAt + DAY;
    const recent = !saved && now - (appliedAt ?? now) < 18 * DAY;
    const r = rng();
    let path: AppStage[];
    if (saved) path = ["saved"];
    else if (i === 13) path = ["saved", "applied", "responded", "interview", "final_round", "offer"];
    else if (i === 20) path = ["saved", "applied", "responded", "interview", "final_round", "rejected"];
    else if (r < p * 0.45) path = rng() < (prepped ? 0.65 : 0.15) ? ["saved", "applied", "responded", "interview", "final_round", "rejected"] : ["saved", "applied", "responded", "interview", "rejected"];
    else if (r < p) path = ["saved", "applied", "responded"];
    else if (recent) path = ["saved", "applied"];
    else path = rng() < 0.55 ? ["saved", "applied", "rejected"] : ["saved", "applied"];
    const history = path.map((stage, k) => ({ stage, at: createdAt + k * 5 * DAY }));
    const stage = path[path.length - 1];
    const [reasonCategory, reasonSource] = pick(REASONS);
    const note = stage === "rejected" && i % 3 !== 2 ? NOTES.find((n) => n.families.test(fam.role)) : undefined;
    const reachedInterview = path.includes("interview");

    apps.push(
      newApplication({
        id: `demo-app-${i}`,
        createdAt,
        role: fam.role,
        company,
        seniority: fam.seniority,
        companyType: fam.companyType,
        stage,
        history,
        jobText: `${fam.role} at ${company}\nRequirements:\n${fam.reqs.map((x) => `- ${x[0]}`).join("\n")}\nWe value experimentation, stakeholders and metrics.`,
        resumeVersion,
        fit: { meta: { role: fam.role, company, seniority: fam.seniority, companyType: fam.companyType }, ratings, score, gaps, source: "rules" },
        demo: true,
        appliedAt,
        source: referred ? "referral" : source,
        location: pick(["Remote", "New York, NY", "Boston, MA"]),
        followUpAt: stage === "applied" ? (appliedAt ?? createdAt) + 7 * DAY : null,
        nextStep: stage === "applied" ? "Follow up with the recruiter" : stage === "interview" ? "Prepare for the next interview" : null,
        outcome: stage === "rejected" ? { at: history[history.length - 1].at, result: "rejected", reasonCategory, reasonSource, notes: note?.notes ?? "", learning: note?.learning ?? "" } : null,
        cv: saved ? null : { text: cvText, base: resumeVersion, tailored, rules: [], at: appliedAt ?? createdAt },
        prepAt: reachedInterview && prepped ? history[path.indexOf("interview")].at : null,
      }),
    );
    const last = apps[apps.length - 1];
    if (!saved) {
      const input = { cvText, jobText: last.jobText, fit: last.fit, app: { cv: last.cv, prepAt: last.prepAt } };
      apps[apps.length - 1] = { ...last, trace: [...traceRules("cv", input), ...traceRules("targeting", input)] };
    }

    if (networked) {
      const cpath: ContactStage[] = ["drafted", "sent", ...(accept ? (["accepted", "messaged"] as ContactStage[]) : []), ...(accept && rng() > 0.4 ? (["replied"] as ContactStage[]) : []), ...(referred ? (["referral"] as ContactStage[]) : [])];
      const variant = opener === "template" ? "A" : "B";
      contacts.push(
        newContact({
          id: `demo-contact-${i}`,
          applicationId: `demo-app-${i}`,
          createdAt: createdAt - DAY,
          firstName: pick(FIRST),
          lastName: pick(LAST),
          title: recipientType === "recruiter" ? "Technical Recruiter" : recipientType === "hiring_manager" ? "Engineering Manager" : "Analyst",
          company,
          recipientType,
          stage: cpath[cpath.length - 1],
          history: cpath.map((s, k) => ({ stage: s, at: createdAt - DAY + k * DAY })),
          variant,
          channel: "linkedin",
          demo: true,
          source: "chat",
          message: demoMessage(opener, opener === "template" ? 190 : 120 + Math.floor(rng() * 70), Math.round(rng() * 40) / 100, createdAt - DAY, lead),
        }),
      );
    }
  }

  // A few network contacts imported from LinkedIn, not yet tied to a job.
  for (let j = 0; j < 4; j++) {
    contacts.push(
      newContact({
        id: `demo-net-${j}`,
        createdAt: now - (20 + j) * DAY,
        firstName: FIRST[(j + 3) % FIRST.length],
        lastName: LAST[j % LAST.length],
        title: ["Data Scientist", "Product Manager", "Recruiter", "Analytics Lead"][j],
        company: COMPANIES[(j + 5) % COMPANIES.length],
        recipientType: j === 2 ? "recruiter" : "alum",
        stage: "not_contacted",
        demo: true,
        source: "linkedin_import",
        connectedOn: "12 Mar 2026",
      }),
    );
  }
  return { applications: apps, contacts };
}
