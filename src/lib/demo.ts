/**
 * Demo mode: clearly labeled synthetic data so reviewers can see Insights and
 * Strategy without logging ten real applications. Every record has demo: true
 * and is never mixed into real metrics or sent to the server.
 */
import type { AppStage, Application, CompanyType, Contact, ContactStage, GapTag, RecipientType, Seniority } from "./schemas";
import { computeScore } from "./fit";
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

const ROLES: [string, Seniority, CompanyType][] = [
  ["Growth Engineer", "entry", "startup"],
  ["Data Analyst", "entry", "enterprise"],
  ["Product Manager, New Grad", "entry", "growth"],
  ["Analytics Engineer", "mid", "startup"],
  ["AI Engineer", "entry", "startup"],
  ["Senior Data Scientist", "senior", "enterprise"],
  ["Business Analyst", "entry", "enterprise"],
  ["Software Engineer, Early Career", "entry", "growth"],
];

const REQS: [string, GapTag][] = [
  ["Ship front-end features in React", "tooling"],
  ["Strong SQL and Python", "tooling"],
  ["Own projects end-to-end", "ownership"],
  ["Run and analyze A/B tests", "quantified_impact"],
  ["Healthcare or fintech domain experience", "domain_visibility"],
  ["5+ years of experience", "seniority"],
  ["Communicate with cross-functional stakeholders", "requirement_evidence"],
];

const COMPANIES = ["Demo Co", "Sample Labs", "Example Health", "Placeholder AI", "Fictional Fintech", "Mock Media", "Synthetic Systems", "Test Pilot"];

export function buildDemoData(seed = 11, now = Date.now()): { applications: Application[]; contacts: Contact[] } {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const apps: Application[] = [];
  const contacts: Contact[] = [];
  const DAY = 86_400_000;

  for (let i = 0; i < 24; i++) {
    const [role, seniority, companyType] = ROLES[i % ROLES.length];
    const createdAt = now - (50 - i * 2) * DAY;
    const ratings = REQS.slice(0, 5).map(([requirement, tag]) => {
      const roll = rng() + (seniority === "senior" && tag === "seniority" ? -0.6 : 0) + (role.includes("Growth") ? 0.2 : 0);
      const evidence = roll > 0.6 ? "strong" : roll > 0.3 ? "partial" : "missing";
      return {
        requirement,
        evidence: evidence as "strong" | "partial" | "missing",
        resumeQuote: evidence === "missing" ? null : DEMO_RESUME.split("\n").find((l) => l.startsWith("- ") && rng() > 0.4)?.slice(2) ?? null,
        gapTag: evidence === "strong" ? null : tag,
        weight: 1,
      };
    }).map((r) => (r.evidence === "strong" && !r.resumeQuote ? { ...r, evidence: "partial" as const, gapTag: "requirement_evidence" as GapTag } : r));
    const score = computeScore(ratings);
    const gaps = [...new Set(ratings.filter((r) => r.gapTag).map((r) => r.gapTag!))];
    if (i % 3 === 0) gaps.push("quantified_impact");

    const roll = rng() + score / 200;
    const path: AppStage[] =
      i >= 20 ? ["saved"] :
      i === 7 ? ["applied", "responded", "interview", "final_round", "offer"] :
      roll > 1.05 ? ["applied", "responded", "interview", "final_round", "rejected"] :
      roll > 0.9 ? ["applied", "responded", "interview"] :
      roll > 0.7 ? ["applied", "responded", "rejected"] :
      roll > 0.45 ? ["applied", "rejected"] : ["applied"];
    const history = path.map((stage, k) => ({ stage, at: createdAt + k * 4 * DAY }));
    apps.push({
      id: `demo-app-${i}`,
      createdAt,
      role,
      company: COMPANIES[i % COMPANIES.length],
      seniority,
      companyType,
      stage: path[path.length - 1],
      history,
      jobText: `${role}\n${REQS.map((r) => `- ${r[0]}`).join("\n")}\nWe value experimentation, stakeholders and metrics.`,
      resumeVersion: i < 9 ? "v1" : "v2",
      fit: { meta: { role, company: COMPANIES[i % COMPANIES.length], seniority, companyType }, ratings, score, gaps: [...new Set(gaps)], source: "rules" },
      demo: true,
    });

    if (i < 18) {
      const cpath: ContactStage[] = ["drafted", "sent", ...(rng() > 0.45 ? (["accepted", "messaged"] as ContactStage[]) : []), ...(rng() > 0.7 ? (["replied"] as ContactStage[]) : [])];
      contacts.push({
        id: `demo-contact-${i}`,
        applicationId: `demo-app-${i}`,
        createdAt: createdAt + DAY,
        firstName: pick(["Sam", "Priya", "Jordan", "Lee", "Morgan"]),
        title: null,
        recipientType: pick<RecipientType>(["alum", "recruiter", "hiring_manager", "team_member"]),
        stage: cpath[cpath.length - 1],
        history: cpath.map((stage, k) => ({ stage, at: createdAt + (k + 1) * DAY })),
        variant: i % 2 ? "B" : "A",
        channel: "linkedin",
        demo: true,
      });
    }
  }
  return { applications: apps, contacts };
}
