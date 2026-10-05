# Warm Intro

A chat-first job-search assistant for early-career candidates that ships its own A/B test.

Paste three things: your resume (once), a job post, and the LinkedIn profile of someone at the company. You get:

- **A fit check.** Each requirement is rated strong, partial or missing, and quotes the resume line that proves it. The score is computed in code.
- **A grounded outreach draft.** It is stage-aware (invite note, accepted follow-up, referral ask), recipient-aware (alum, recruiter, HR, hiring manager, team member) and channel-aware (LinkedIn, email, platform message). Every personalized phrase shows its source on hover.
- **A tracker.** Applications and contacts with stages, sources (cold, referral, recruiter), dates, next steps and overdue follow-ups; search and filters; an outcome log that keeps employer-stated rejection reasons separate from guesses; a network view with LinkedIn `Connections.csv` import; and JSON/CSV backup and restore.
- **A learning loop.** The app compares the applications that got a response with the ones that didn't, and the outreach that got accepted with the outreach that didn't, then feeds what it finds back into the next application:
  - a **"Craft this application"** card for every job you paste (resume version, gap to fix first, who to message, how to open, words to borrow), each with its reason and the past applications it's based on;
  - a **personal playbook** of rules learned from your outcomes, reworded by the AI, number-checked by code, and used only after you accept them;
  - **Thompson sampling** over message openings, so drafts mostly use what works for you but still test alternatives.
- **Insights and next steps** with confidence intervals, a pre-apply checklist from recurring gaps, resume tweaks that never invent facts, and similar companies after a final-round rejection.

### Evidence tiers instead of unlock gates

Suggestions are never hidden behind a threshold; they carry a label that upgrades as data grows.

| Data | What the app does | Label |
|---|---|---|
| 0–4 outcomes | Suggestions from the job post and your resume only | Based on this job post |
| 5 outcomes, ≥1 success and ≥1 failure | Personal suggestions start, comparing successes with failures | Early signal |
| 5 sent messages, ≥1 accepted | Message-style suggestions start | Early signal |
| 15 outcomes | Comparisons within a role family become meaningful | Pattern |
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

## Privacy

- Profiles, applications, contacts and chats live in **IndexedDB in the user's browser**.
- Pasted text is sent to the model only for the request that needs it. It is **never stored server-side and never logged**.
- The server stores only anonymous experiment events: a random ID, the variant, the event type, and a small number. No names and no text.
- Server logs are structured JSON audit lines (who, what, why, source, latency) with no document content.
- Demo mode uses clearly labeled synthetic data that never reaches metrics or the server.

## Stack

Next.js 16.3.8 (App Router), React 19.2, TypeScript 5.9, Tailwind CSS 4, Zod 4.6, `@anthropic-ai/sdk` 0.131, `@neondatabase/serverless` 1.2, Dexie 4, Vitest 5, and Playwright 1.63. Fonts are self-hosted through `@fontsource-variable`.

## Run locally

```bash
npm install
cp .env.example .env.local   # all values optional
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | 96 unit tests: statistics, classifier, fit scoring, shared ground, drafting, validators, tracker, CSV and backups, the learning loop and playbook, and the AI services (mocked model) |
| `npm run test:e2e` | Playwright on a production build: both A/B arms, event logging, tracker, outcome logging, export, the learning card, the playbook, and accessibility (axe) |
| `npm run typecheck && npm run lint` | Static checks |

## Continuous integration

The workflow is in `docs/ci.yml` because the tool used to publish this repo cannot write to `.github/workflows`. To turn it on, move it to `.github/workflows/ci.yml` (GitHub web UI: open the file, rename the path). It runs typecheck, lint, unit tests, build, and the end-to-end suite on every push and pull request.

No lockfile is committed yet, so CI uses `npm install`. Every dependency in `package.json` is pinned to an exact version; commit the `package-lock.json` from your first local install and switch CI to `npm ci`.

## Deploy (Vercel + Neon)

1. Import the GitHub repo in Vercel. The defaults work.
2. Optional: create a free Neon Postgres database and set `DATABASE_URL`. The events table is created on first write. Without it, events live in memory and reset on each deploy.
3. Optional: set `ANTHROPIC_API_KEY` and, if you want a different model, `ANTHROPIC_MODEL`.
4. Check `/api/status`, which reports whether AI and durable storage are on.

## Known limits

- The live model path is unit-tested with mocked responses. It runs against the real API once a key is configured.
- LinkedIn invite-note limits (200 characters free, 300 Premium) come from 2026 third-party guides. LinkedIn does not publish them.
- Similar-company suggestions come from the model's knowledge. Users are told to verify that each company is hiring.
- Rejection "reasons" are presented as likely patterns, never as the employer's actual decision.

## Acknowledgments

Tracker, outcome logging, network, and Insights features adapted from Sanjana Gowda's AI Job Tracker and Rejection Analyzer ([github.com/sanjana1311/job-tracker](https://github.com/sanjana1311/job-tracker)). The implementation here is original; no code was copied.

See `BUILD_LOG.md` for how this was built and `PLAYBOOK.md` to reuse the experiment setup.
