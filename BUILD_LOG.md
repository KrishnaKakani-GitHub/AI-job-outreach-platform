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

## What was automated

- Scaffolding, typed schemas and test suites
- The screenshot script (`npm run screenshots`) and the end-to-end suite used as the review loop
- A CI workflow (typecheck, lint, unit tests, build, end-to-end), kept in `docs/ci.yml` until it is moved into `.github/workflows`

## Bugs worth remembering

- A `beforeEach(() => mock.mockReset())` arrow returned the mock. Vitest treats a returned function as a teardown hook, so it called the throwing mock after the test. Fix: use a braced body.
- Chromium on the build machine did not match Playwright's expected browser revision. The scripts accept `CHROMIUM_PATH`, and CI installs the matching browser.
- Google Fonts were unreachable from the build environment, so fonts are self-hosted through npm.
