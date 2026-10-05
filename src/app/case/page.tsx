import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, PageShell } from "@/components/PageShell";
import { sampleSizePerArm } from "@/lib/stats";

export const metadata: Metadata = { title: "Case study · Warm Intro", description: "The product loop behind Warm Intro: user, problem, hypothesis, MVP, evidence, iteration." };

/** Next-test candidates scored with RICE. Inputs are planning estimates, not measurements. */
const RICE = [
  { name: "Pooled reply-rate test across users", reach: 8, impact: 3, confidence: 0.5, effort: 3 },
  { name: "Rejection-email inbox (Gmail, read-only)", reach: 6, impact: 2, confidence: 0.5, effort: 5 },
  { name: "Interview prep from the job post", reach: 5, impact: 2, confidence: 0.8, effort: 2 },
  { name: "Drag-and-drop PDF or DOCX resume", reach: 9, impact: 1, confidence: 0.8, effort: 1 },
].map((r) => ({ ...r, score: Math.round(((r.reach * r.impact * r.confidence) / r.effort) * 10) / 10 })).sort((a, b) => b.score - a.score);

const PRINCIPLES: [string, string][] = [
  ["Users first", "Started from a behavior observed in a real job search, not from a feature idea. Pasted documents stay in the user's browser."],
  ["Create with craft and beauty", "The draft is set like a letter, every personalized phrase shows its source on hover, and the interface works by keyboard, on phones, and in dark mode."],
  ["Move with urgency and focus", "Scoped to two days. Gmail scanning, interview prep and file upload were deliberately cut and listed in the changelog."],
  ["Collaborate egolessly", "The repository includes a playbook so others can reuse the experiment setup."],
  ["Stay curious", "The lab tests the statistics on known answers before trusting live data, including what goes wrong when you peek."],
  ["Obsess over talent", "The product exists to help early-career candidates show their real strengths, truthfully."],
];

export default function CasePage() {
  return (
    <PageShell current="/case">
      <H1 lede="A two-day build that runs the full product loop: problem, hypothesis, prototype, user behavior, learning, iteration. The prototype is the cheap part; the decisions are the work.">
        Case study: Warm Intro
      </H1>

      <nav aria-label="Sections" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-ink-2">
        {["User", "Problem", "Hypothesis", "MVP", "Evidence", "Iteration"].map((s, i) => (
          <a key={s} href={`#s${i + 1}`} className="hover:text-ink">
            {i + 1}. {s}
          </a>
        ))}
      </nav>

      <Prose>
        <H2 id="s1">1. The user</H2>
        <p>
          Early-career candidates (0 to 2 years out) applying at volume and reaching out to alumni, recruiters and team members for referrals. They have real experience but little practice turning it into a short, specific note to a stranger.
        </p>

        <H2 id="s2">2. The problem</H2>
        <p>
          It began with an observed behavior in my own search. As my application volume went up, the share of applications where I wrote personalized outreach went down: writing a good note for each person didn&apos;t scale, so I fell back on a template. And because my tracker never recorded which message I sent to whom, I couldn&apos;t learn which wording worked.
        </p>
        <p>
          Two problems, then: <strong>scale</strong> (drafting is slow) and <strong>learning</strong> (no feedback loop). Generic AI writing tools fix the first and make a third problem worse: they invent shared history (“I loved your talk at…”) that the sender never had.
        </p>

        <H2 id="s3">3. The hypothesis</H2>
        <p>
          A draft grounded in the recipient&apos;s actual profile and the sender&apos;s actual resume will be sent more often than the sender&apos;s own fill-in-the-blanks template, without people needing to rewrite it heavily.
        </p>
        <ul>
          <li><strong>Primary metric (HEART: Task success; AARRR: Activation):</strong> copy rate, users who copy a message ÷ users who get a draft.</li>
          <li><strong>Guardrails:</strong> seconds to copy, and how much of the draft gets rewritten.</li>
          <li><strong>Why not reply rate:</strong> at a 2.6% baseline, detecting a 50% lift needs {sampleSizePerArm(0.026, 0.013).toLocaleString()} messages per arm. Copy rate is measurable now; reply rate is the next test.</li>
        </ul>

        <H2 id="s4">4. The MVP</H2>
        <p>A chat where you paste three things: your resume (once), a job post, and someone&apos;s LinkedIn profile.</p>
        <ul>
          <li><strong>Fit check:</strong> each requirement rated strong, partial or missing, with the resume line that proves it. The score is computed in code, never by the model.</li>
          <li><strong>Grounded draft:</strong> stage-aware (invite note, follow-up, referral ask), recipient-aware, color-coded by part. Every personal detail links to its source, and code rejects any name that appears in none of the documents.</li>
          <li><strong>Tracker:</strong> applications, contacts, sources, follow-ups and an outcome log that separates what employers said from guesses, plus LinkedIn import and backups.</li>
          <li><strong>Learning loop:</strong> every new job gets a &ldquo;Craft this application&rdquo; card built from the difference between your applications that got a response and the ones that didn&apos;t. Each suggestion shows its reason, the past applications behind it, and an evidence label (job post only → early signal at 5 outcomes → pattern at 15 → strong at 30 per group). Rules you accept go into a personal playbook that shapes every draft, and message openings are chosen by Thompson sampling so the app keeps testing instead of locking in early luck.</li>
          <li><strong>Skills that learn:</strong> ten baseline skills (resume tailoring, bullets, numbers, keyword coverage, outreach, interview prep and more) are used unchanged, then each grows a personal layer. Every checkable piece of advice is scored against the user&apos;s own outcomes per job type and paused where it isn&apos;t working; accepted rules from outcomes, job-post patterns, successful outreach and the user&apos;s notes are added on top. Each output shows exactly what the model saw, and a tailored resume can be compared with what the baseline skills alone produce.</li>
        </ul>
        <p><strong>Deliberately left out:</strong> auto-sending, LinkedIn scraping or login, accounts, server-side storage of documents, Gmail scanning, interview prep, and full resume rewrites (they tend to invent experience).</p>
        <p><strong>Design rule:</strong> the AI proposes; deterministic code validates and decides. If the model is unavailable or fails a check, the app falls back to a rules-based version instead of showing an unchecked draft.</p>

        <H2 id="s5">5. The evidence</H2>
        <p>
          The experiment is live: each person who drafts is randomly assigned to the template (A) or the AI draft (B). The plan, including sample size and decision rule, was written before launch and is shown on the{" "}
          <Link href="/results">results page</Link>, which recomputes from the event log on every refresh. Results are reported at whatever sample exists, labeled as directional until the planned sample is reached.
        </p>
        <p>
          Before trusting live numbers, the <Link href="/lab">lab</Link> checks the method on simulated data with known answers: A/A tests hold false alarms near 5%, peeking inflates them several-fold, and a skewed split trips the sample-ratio alarm.
        </p>

        <H2 id="s6">6. The iteration</H2>
        <p>What changes next is decided by the live result and by RICE scores for the candidate tests below (inputs are planning estimates).</p>
        <p className="text-[14px] text-ink-3">
          Tracker, outcome logging, network, and Insights features were adapted from Sanjana Gowda&apos;s AI Job Tracker and Rejection Analyzer (<a href="https://github.com/sanjana1311/job-tracker">github.com/sanjana1311/job-tracker</a>). The implementation is original. The baseline skills are Param Choudhary&apos;s ResumeSkills (<a href="https://github.com/Paramchoudhary/ResumeSkills">github.com/Paramchoudhary/ResumeSkills</a>, MIT), included unchanged; the scoring and personal layer are original.
        </p>
      </Prose>

      <table className="mt-3 w-full max-w-3xl text-left text-[14px]">
        <caption className="sr-only">Next tests ranked by RICE</caption>
        <thead className="text-[12.5px] text-ink-3">
          <tr>
            <th className="py-1 font-normal">Candidate</th>
            <th className="py-1 font-normal">Reach</th>
            <th className="py-1 font-normal">Impact</th>
            <th className="py-1 font-normal">Confidence</th>
            <th className="py-1 font-normal">Effort</th>
            <th className="py-1 font-normal">RICE</th>
          </tr>
        </thead>
        <tbody>
          {RICE.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <td className="py-2 pr-3">{r.name}</td>
              <td>{r.reach}</td>
              <td>{r.impact}</td>
              <td>{r.confidence}</td>
              <td>{r.effort}</td>
              <td className="font-medium">{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>Operating principles behind the build</H2>
      <dl className="max-w-3xl divide-y divide-line border-y border-line">
        {PRINCIPLES.map(([p, how]) => (
          <div key={p} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
            <dt className="text-[15px] font-medium">{p}</dt>
            <dd className="text-[15px] text-ink-2">{how}</dd>
          </div>
        ))}
      </dl>
    </PageShell>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[68ch] text-[16px] leading-[1.7] [&_a]:underline [&_a]:decoration-accent [&_a]:underline-offset-4 [&_li]:mb-1.5 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">{children}</div>;
}
