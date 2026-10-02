# Warm Intro

A chat-first job-search assistant for early-career candidates that ships its own A/B test.

Paste three things: your resume (once), a job post, and the LinkedIn profile of someone at the company. You get:

- **A fit check.** Each requirement is rated strong, partial or missing, and quotes the resume line that proves it. The score is computed in code.
- **A grounded outreach draft.** It is stage-aware (invite note, accepted follow-up, referral ask), recipient-aware (alum, recruiter, HR, hiring manager, team member) and channel-aware (LinkedIn, email, platform message). Every personalized phrase shows its source on hover.
- **A tracker, Insights and next steps.** After enough history the app shows conversion and rejection patterns with confidence intervals, a pre-apply checklist built from your recurring gaps, resume tweaks that never invent facts, and similar companies after a final-round rejection.

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
| `npm test` | 52 unit tests: statistics, classifier, fit scoring, shared ground, drafting, validators, strategy, and the AI services (mocked model) |
| `npm run test:e2e` | Playwright on a production build: both A/B arms, event logging, tracker, public pages |
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

See `BUILD_LOG.md` for how this was built and `PLAYBOOK.md` to reuse the experiment setup.
