# Build log

This was a two-day build with an AI coding agent, which planned, wrote and tested most of the code. This log records the decisions, what the AI did, and what was checked by hand.

## Day 0: deciding what to build

- **Started from the questions a hiring team actually asked.** What have you shipped on the front end, and have you run an experiment on real users? Every scope decision traces back to those two questions.
- **Dropped three earlier concepts.** A careers-page quiz, a fundraising tool, and a dataset re-analysis were each cut because they lacked a behavior I had personally observed, or real users within 48 hours.
- **Chose the problem I had lived.** As my application volume rose, my personalized outreach fell, and I had no record of which messages worked.
- **Chose a leading metric.** Reply rates of around 2.6% need about 2,900 messages per arm to test, so the primary metric became "copied the draft."

## Day 1: core, then UI

1. **Deterministic core first** (`src/lib`): statistics, classifier, fit scoring, shared-ground detection, drafting templates, validators, insights and strategy. These were unit-tested before any UI existed. The statistics tests check against known values, including a published 90k-player retention test (p ≈ 0.0016, sample-ratio p ≈ 0.009).
2. **AI layer** (`src/server`): every model call is a forced tool call with a Zod schema. Outputs that fail validation are retried once with the failure messages, then fall back to the rules engine.
3. **Chat UI**: the composer collapses long pastes into chips, each paste is auto-classified with a one-click correction, and results render as cards.

## Day 2: experiment, polish, verification

- A/B assignment by FNV-1a hash of an anonymous ID. Events (`exposure`, `draft_generated`, `copied`, `edited`) go to Postgres. `/results` recomputes the outcome on every load.
- The lab page simulates A/A tests, power, peeking and sample-ratio mismatch in the browser.
- The two chart series colors were checked with a palette validator (lightness, chroma, colorblind separation, contrast) in both themes.
- Screenshots of every screen were reviewed at desktop and phone widths, in light and dark mode. Fixed along the way:
  - auto-scroll stopped mid-stream
  - false "shared ground" matches on section headers
  - a misleading rejection-rate denominator
  - future-dated demo data

## v1.1: from tracker to learning loop

- **Tracker parity.** Outcome logging, manual entry, sources, follow-ups, search and filters, a network view, LinkedIn import and backups, adapted from Sanjana Gowda's job-tracker idea and rebuilt in typed React. Every record passes a Zod schema on write and on import, and v1 records are upgraded in place (IndexedDB v2 migration).
- **Outcomes defined first.** A success is any response; a failure is a rejection without one or 21 days of silence. Message success is acceptance or better; failure is 14 days of silence.
- **No unlock gates.** Instead of hiding Insights until 10 messages, every suggestion carries an evidence tier (job post → early signal at 5 outcomes with both a success and a failure → pattern at 15 → strong at 30 per group).
- **Personal suggestions.** Similar past applications (role family, seniority, requirement overlap) are compared on resume version, gaps, networking before applying, recipient type and opening; each suggestion cites its counts and the applications behind it.
- **Playbook.** Code finds contrasts, the model rewords them, a validator rejects any number not in the evidence, and the user accepts or dismisses each rule. Accepted rules feed drafts and the craft card; rules the data stops supporting are paused automatically.
- **Bandit.** Openings are chosen by seeded Thompson sampling over Beta posteriors, so early luck can't lock in a style. It only shapes variant B, so the A/B test stays clean.
- **Checked by:** 44 new unit tests (outcomes, tiers, contrasts, bandit, playbook sync, CSV edge cases including formula injection, backup validation) and 4 new end-to-end tests including an axe scan of the tracker and Insights.

## v1.2: skills that learn from outcomes

- **Baseline, unchanged.** Ten `SKILL.md` files from Param Choudhary's ResumeSkills (MIT) ship in `skills/baseline/` and are sent to the model as written: the primary skill for each action in full (prompt-cached), supporting skills as condensed advice.
- **Scoring the advice.** Each piece of advice that code can check (action verbs, numbers in bullets, standard headings, keyword coverage, a summary that matches the role, tailoring at all, interview prep) is checked on the resume that actually went out. The resume is frozen when an application is applied for, so its outcome can score each rule: followed vs not, overall and per job type, with job types shrunk toward the overall rate.
- **Job types.** Analytics engineering is no longer lumped with data engineering, and the user can override the guessed type. Requirement terms are compared by whether the resume showed them, among posts that asked, so the app can tell "posts that ask for dbt" from "dbt on my resume".
- **Personal layer.** Accepted rules (from outcomes, job-type patterns, the resume line successful outreach led with, and AI-read outcome notes) plus working and paused baseline advice make up each skill's personal layer. A new version is recorded whenever it changes, with what changed. Exploration holds an accepted rule back at most 20% of the time when its evidence is uncertain, so it keeps getting tested.
- **Checked outputs.** Tailored resumes only reword and reorder existing lines; code rejects new numbers, job-post terms the resume never mentions, and unknown names, and shows what it blocked. Interview prep replaces unsupported details with `[fill in]`.
- **Verifiable.** Every AI output carries a manifest built from the same inputs as its prompt. Tests check the prompt contains everything the manifest lists and nothing held back, and that the baseline-only comparison sends no personal layer.
- **Insight ledger and memory.** Each rule is scored twice: on getting a response and on getting an interview. Every AI message, kept resume, application, interview, outcome, rule decision and skill version is written to a local memory log, and every outcome triggers a re-score of every skill.
- **Checked by:** 46 new unit tests and 2 new end-to-end tests, including axe scans of the Skills panel and the tailored resume (which caught two scrollable regions that weren't keyboard-focusable).

## What was automated

- Scaffolding, typed schemas and test suites
- The screenshot script (`npm run screenshots`) and the end-to-end suite used as the review loop
- A CI workflow (typecheck, lint, unit tests, build, end-to-end), kept in `docs/ci.yml` until it is moved into `.github/workflows`

## Bugs worth remembering

- A `beforeEach(() => mock.mockReset())` arrow returned the mock. Vitest treats a returned function as a teardown hook, so it called the throwing mock after the test. Fix: use a braced body.
- Chromium on the build machine did not match Playwright's expected browser revision. The scripts accept `CHROMIUM_PATH`, and CI installs the matching browser.
- Google Fonts were unreachable from the build environment, so fonts are self-hosted through npm.
