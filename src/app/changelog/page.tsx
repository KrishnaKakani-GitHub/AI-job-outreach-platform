import type { Metadata } from "next";
import { H1, PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Changelog · AI Job Tracker", description: "What shipped, and what is next." };

const ENTRIES = [
  {
    version: "v1.2",
    date: "October 5, 2026",
    shipped: [
      "Skills: ten baseline skills from ResumeSkills, used unchanged, each with a personal layer learned from your outcomes, a version history, and a SKILL.md export for Claude.",
      "Every checkable piece of baseline advice is scored against your outcomes per job type; advice that isn't working for you is paused.",
      "Patterns by job type: what each kind of role asks for, which asks mattered once your resume showed them, and which post features went with a response.",
      "Tailored resume for each job, built only from your own lines, with each change tied to its rule and a side-by-side baseline comparison.",
      "Interview prep when an application reaches the interview stage, with STAR outlines from your resume and [fill in] where it is silent.",
      "Rules from your outcome notes, proposed by AI, checked by code, used only after you accept them.",
      "Insight ledger: every insight is graded on responses and on interviews; Insights shows what was on your resume for each interview, and each job type gets an apply-more or apply-less signal.",
      "Memory log of every AI message, resume sent, interview, outcome and skill change; every outcome re-scores every skill.",
      "“What the AI saw” on every AI output.",
    ],
  },
  {
    version: "v1.1",
    date: "October 5, 2026",
    shipped: [
      "Learning loop: a “Craft this application” card for every job, built from what separated your responses from your silences, with reasons and linked evidence.",
      "Evidence tiers instead of unlock gates: job post only, early signal at 5 outcomes, pattern at 15, strong at 30 per group.",
      "Personal playbook: rules learned from your outcomes, reworded by AI, number-checked by code, used only after you accept them.",
      "Thompson sampling over message openings, so drafts favor what works for you and keep testing alternatives.",
      "Tracker: manual add and edit, sources, follow-up dates, overdue flags, search and filters, and a summary strip.",
      "Outcome log that keeps employer-stated reasons separate from guesses; Insights shows both.",
      "Network view with LinkedIn Connections.csv import (emails dropped), and JSON/CSV backup and restore.",
      "Design: styled dropdowns, switch, compact draft controls on phones, and a clearer results page.",
    ],
  },
  {
    version: "v1.0",
    date: "October 2, 2026",
    shipped: [
      "Chat interface: paste a resume, job post, or LinkedIn profile and the app works out which it is.",
      "Fit check with per-requirement evidence and a pre-apply checklist built from recurring gaps.",
      "Grounded outreach drafts with stage, recipient and channel controls, source-on-hover, a LinkedIn character counter, and style checks.",
      "Live A/B test (template vs. AI draft) with a public results page and a pre-registered plan.",
      "Local-only tracker, Insights after 10 sent messages, next-step advice after 10 applications, and similar-company suggestions after a final-round rejection.",
      "Experiment lab with A/A, power, peeking and sample-ratio simulations.",
    ],
  },
];

const NEXT = [
  "Pooled, anonymous learning across users (opt-in) so new users get patterns on day one.",
  "Drag-and-drop PDF and DOCX resumes.",
  "Interview questions generated from the job post.",
  "Pooled reply-rate test once enough users report outcomes.",
  "Read-only rejection inbox (needs Google sign-in; privacy review first).",
  "Live check that suggested similar companies are hiring.",
];

export default function ChangelogPage() {
  return (
    <PageShell current="/changelog">
      <H1>Changelog</H1>
      {ENTRIES.map((e) => (
        <section key={e.version} className="mb-10 max-w-[68ch]">
          <h2 className="text-[20px] font-semibold">
            {e.version} <span className="ml-2 text-[14px] font-normal text-ink-3">{e.date}</span>
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15.5px]">
            {e.shipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className="mt-12 max-w-[68ch]">
        <h2 className="text-[20px] font-semibold">Planned next</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15.5px] text-ink-2">
          {NEXT.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
