# AI Job Tracker

A chat-first job-search assistant for early-career candidates that ships its own A/B test.

Paste three things: your resume (once), a job post, and the LinkedIn profile of someone at the company. You get:

- **A fit check.** Each requirement is rated strong, partial or missing, and quotes the resume line that proves it. The score is computed in code.
- **A grounded outreach draft.** It is stage-aware (invite note, accepted follow-up, referral ask), recipient-aware (alum, recruiter, HR, hiring manager, team member) and channel-aware (LinkedIn, email, platform message). Every personalized phrase shows its source on hover.
- **A tracker.** Applications and contacts with stages, sources (cold, referral, recruiter), dates, next steps and overdue follow-ups; search and filters; an outcome log that keeps employer-stated rejection reasons separate from guesses; a network view with LinkedIn `Connections.csv` import; and JSON/CSV backup and restore.
- **A learning loop.** The app compares the applications that got a response with the ones that didn't, and the outreach that got accepted with the outreach that didn't, then feeds what it finds back into the next application:
  - a **"Craft this application"** card for every job you paste (resume version, gap to fix first, who to message, how to open, words to borrow), each with its reason and the past applications it's based on;
  - a **personal playbook** of rules learned from your outcomes, reworded by the AI, number-checked by code, and used only after you accept them;
  - **Thompson sampling** over message openings, so drafts mostly use what works for you but still test alternatives.
- **Skills that learn from your outcomes.** Ten baseline skills from [ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills) (job description analyzer, resume tailor, bullet writer, quantifier, ATS optimizer, tech resume optimizer, cold email writer, cover letter generator, version manager, interview prep generator) ship unchanged in `skills/baseline/`. Each grows a personal layer:
  - every checkable piece of advice is scored against your outcomes, overall and per job type, and paused where it isn't working for you;
  - rules learned from your outcomes, job-type patterns, successful outreach and your own outcome notes are added once you accept them;
  - each skill keeps a version history and exports as a `SKILL.md` you can upload to Claude.
- **Patterns by job type.** Data analytics, analytics engineering, product and the rest are compared separately: what their posts ask for, which asks mattered once your resume showed them, and which post features (seniority, years required, number of must-haves) went with a response, which advice works there, and a targeting signal (apply more, apply less, not clear yet) from the job type's 95% range against your overall rate. The Craft card matches each new post against your current resume: "This post asks for dbt and your resume doesn't show it; Analytics engineering posts asking for it got a response 6 of 7 times when the resume showed it." Small job types are pulled toward your overall rate until they have data of their own.
- **An insight ledger and memory log.** Every AI message, every resume that went out (with the insights it followed), every interview and outcome, and every change the skills made because of them is logged in your browser. Each insight is graded on two results, getting a response and getting an interview, so when an interview comes you can see exactly what was on the resume that got it. Every new outcome re-scores every skill. Analysis starts with the first outcome; milestones at 1, 15, 50, 200 and 500 outcomes show when results firm up.
- **A tailored resume for each job.** Built only from lines already in your resume, with every change tied to the rule that caused it. Code blocks new numbers, unsupported job-post terms and unknown names. A side-by-side view compares it with what the baseline skills alone produce.
- **Interview prep** when an application reaches the interview stage: likely questions from the post, STAR outlines from your own resume lines, and `[fill in]` wherever the resume is silent.
- **"What the AI saw"** on every draft, tailored resume and prep card: the skills and versions, your learned rules and their evidence, job-type facts and documents, generated from the request that was actually sent.
- **Insights and next steps** with confidence intervals, a pre-apply checklist from recurring gaps, resume tweaks that never invent facts, and similar companies after a final-round rejection.

### Evidence tiers instead of unlock gates

Suggestions are never hidden behind a threshold; they carry a label that upgrades as data grows.

| Data | What the app does | Label |
|---|---|---|
| No outcomes yet | Suggestions from the job post and your resume only | Based on this job post |
| 1+ outcome | Personal suggestions start immediately, with their counts shown ("1 of 1") | Early signal |
| 1+ resolved message | Message-style suggestions start | Early signal |
| 15 outcomes, ≥1 success and ≥1 failure | Comparisons within a role family become meaningful | Pattern |
| 30 outcomes per comparison group | Differences this large are unlikely to be luck | Strong pattern |

A success is any response (a reply, an interview or better). A failure is a rejection without a response, or no response 21 days after applying.

Every drafting session is randomly assigned to **A: your own four-part template** or **B: the AI draft**. Results are public at `/results`.

| Page | What it is |
|---|---|
| `/` | The chat app |
| `/results` | Live A/B results against a pre-registered plan |
| `/lab` | Simulations of A/A false positives, power, peeking, and sample-ratio mismatch |
| `/case` | The six-section product case study |
| `/changelog` | What shipped and what is next |

## Design rule: the AI proposes, code decides

```
paste ──► rules classifier ──► typed tool endpoint ──► Claude (forced tool call)
                                                         │
                                         Zod schema ◄────┘
                                              │
                         deterministic checks (lib/validators.ts, lib/fit.ts)
                         • every claim quotes its source verbatim
                         • no name absent from all three documents
                         • character limit, style rules, relevance
                         • scores and rates recomputed in code
                                              │
                    pass ─► render card        fail ─► retry once with feedback ─► rules fallback
```

The app works fully **without an API key**. It falls back to the rules engine for classification, fit scoring and drafting. AI improves the wording but is never the source of a number.

## Checking that the personal layer is real

- **What the AI saw** on each output lists the skills, versions, learned rules and facts that went into that request. It is built from the same inputs as the prompt, and a unit test checks that every listed item is in the prompt and nothing held back is.
- **Compare with baseline skills** on a tailored resume runs the same job through the baseline skills alone, side by side.
- **Version history** in the Skills panel shows what each skill learned or paused, when, and from which counts ("Added learned "Lead with SQL modeling" for Analytics engineering, based on Early signal. 4 of 5 ...").
- **Memory log** in the Skills panel records every message, resume, interview, outcome and skill change, and exports as text.

A test also checks that proposed, dismissed and no-longer-supported rules never reach the model. This is not a retrained model. The model is steered by your accepted rules and the computed evidence; numbers come from code; the scores update as outcomes come in.

## Privacy

- Profiles, applications, contacts and chats live in **IndexedDB in the user's browser**.
- Pasted text is sent to the model only for the request that needs it. It is **never stored server-side and never logged**.
- The server stores only anonymous experiment events: a random ID, the variant, the event type, and a small number. No names and no text.
- Server logs are structured JSON audit lines (who, what, why, source, latency) with no document content.
- Demo mode uses clearly labeled synthetic data that never reaches metrics or the server.

## Stack

Next.js 16.3.8 (App Router), React 19.2, TypeScript 5.9, Tailwind CSS 4, Zod 4.6, `@anthropic-ai/sdk` 0.131, `@neondatabase/serverless` 1.2, Dexie 4, fflate 0.8.3 (skill export), Vitest 5, and Playwright 1.63. Fonts are self-hosted through `@fontsource-variable`.

## Run locally

```bash
npm install
cp .env.example .env.local   # all values optional
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | 185 unit tests: statistics, classifier, fit scoring, the resume library and reply guard, shared ground, drafting, validators, tracker, CSV and backups, the learning loop and playbook, skill scoring, job-type patterns, tailoring and prep checks, prompt composition, and the AI services (mocked model) |
| `npm run test:e2e` | Playwright on a production build: both A/B arms, event logging, tracker, outcome logging, export, the learning card, the playbook, skills and SKILL.md export, the tailored resume and its baseline comparison, and accessibility (axe) |
| `npm run typecheck && npm run lint` | Static checks |

## Continuous integration

The workflow is in `docs/ci.yml` because the tool used to publish this repo cannot write to `.github/workflows`. To turn it on, move it to `.github/workflows/ci.yml` (GitHub web UI: open the file, rename the path). It runs typecheck, lint, unit tests, build, and the end-to-end suite on every push and pull request.

No lockfile is committed yet, so CI uses `npm install`. Every dependency in `package.json` is pinned to an exact version, including `playwright-core`: `@axe-core/playwright` lists it as a loose peer (`>= 1.0.0`), which otherwise pulls a newer Playwright than `@playwright/test` and breaks the build's typecheck. Commit the `package-lock.json` from your first local install and switch CI to `npm ci`.

## Acknowledgments

- Baseline skills: Param Choudhary's ResumeSkills ([github.com/Paramchoudhary/ResumeSkills](https://github.com/Paramchoudhary/ResumeSkills), MIT). Ten `SKILL.md` files are included unchanged in `skills/baseline/` with their license; see `THIRD_PARTY_NOTICES.md`. The scoring, personal layer and export are original to this project.
- Tracker, outcome logging, network, and Insights features adapted from Sanjana Gowda's AI Job Tracker and Rejection Analyzer ([github.com/sanjana1311/job-tracker](https://github.com/sanjana1311/job-tracker)). The implementation here is original; no code was copied.
