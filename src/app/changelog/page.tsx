import type { Metadata } from "next";
import { H1, PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Changelog · Warm Intro", description: "What shipped, and what is next." };

const ENTRIES = [
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
        <section key={e.version} className="max-w-[68ch]">
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
        <h2 className="text-[20px] font-semibold">Planned for v1.1</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15.5px] text-ink-2">
          {NEXT.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
