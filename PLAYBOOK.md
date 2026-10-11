# Playbook: ship an A/B-tested AI feature in two days

A reusable recipe, taken from how AI Job Tracker was built. Fork the relevant files.

## 1. Pick the metric before the feature
- Write the hypothesis in one sentence.
- Check the sample size first: `sampleSizePerArm(baseline, lift)` in `src/lib/stats.ts`. If the metric you care about needs thousands of users per arm, pick a leading metric you can actually move this week.
- Pre-register the following on a public page (see `src/app/results/ResultsView.tsx`):
  - the primary metric
  - guardrail metrics
  - sample size
  - decision rule
  - "no early calls"

## 2. Validate the method before trusting data
- Run A/A simulations. The false-positive rate should be about alpha.
- Run the peeking simulation, so everyone sees why stopping early is banned.
- Add a sample-ratio-mismatch check to the results page. If it alarms, fix assignment before reading results.

All of these are in `src/lib/stats.ts`, and `src/app/lab` gives them a UI.

## 3. Assign deterministically, log minimally
- `assignVariant(anonId)` hashes a random per-browser ID, so the same browser always gets the same arm.
- Log only `{anonId, experiment, variant, type, value}`. No text, no personal data.
- Attribute each user to their first exposure, and count unique users per event type (`src/server/store.ts`).
- Exclude forced-variant URLs and demo sessions from tracking.

## 4. Make the AI propose and code decide
- Force a single tool call and validate its output with Zod (`src/server/ai.ts`).
- Recompute every number in code. Never accept a score from the model.
- Write deterministic checks for what matters in your domain. Here, that is verbatim grounding, unknown names, length and style (`src/lib/validators.ts`).
- On failure, retry once with the validator's messages, then fall back to a rules-based version. The feature never shows unchecked output.

## 5. Report honestly
- Show n, the interval, and "directional until the planned sample size" on every result.
- Label hypotheses as hypotheses. A rejection email tells you *that*, not *why*.

## Checklist
- [ ] Hypothesis, metric, guardrails, sample size and decision rule are public before launch
- [ ] A/A simulation is about alpha; peeking demo exists; SRM check is live
- [ ] Assignment is deterministic; events contain no personal data
- [ ] Model output is schema-validated, numbers are recomputed, and a fallback path is tested
- [ ] The results page shows intervals and sample size
