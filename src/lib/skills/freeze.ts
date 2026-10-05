/**
 * Freezing the resume that went out with an application, and recording which
 * skill rules it followed, so the application's outcome can score those rules.
 */
import type { Application, CvSnapshot } from "../schemas";
import { traceRules } from "./catalog";
import type { ContextManifest, SkillContext } from "./context";

/**
 * Freeze the resume that went out with an application and record which
 * rules it followed. Called when an application moves to "applied" and when
 * the user keeps a tailored version.
 */
export function freezeCv(app: Application, resume: string, base: string, tailored: { text: string; rules: string[] } | null, now: number): Pick<Application, "cv" | "trace"> {
  const cv: CvSnapshot = tailored
    ? { text: tailored.text, base, tailored: true, rules: tailored.rules, at: now }
    : (app.cv ?? { text: resume, base, tailored: false, rules: [], at: now });
  const input = { cvText: cv.text, jobText: app.jobText, fit: app.fit, app: { cv, prepAt: app.prepAt } };
  return { cv, trace: [...traceRules("cv", input), ...traceRules("targeting", input)] };
}

/** Signed learned-rule list for a kept tailored CV: applied ids, and "!id" for rules held back or not applied. */
export function signedRules(applied: string[], context: SkillContext | null, manifest: ContextManifest | null): string[] {
  const learned = (manifest?.learned ?? context?.learned ?? []).map((r) => r.id);
  const explore = manifest?.explore ?? context?.explore ?? [];
  const appliedSet = new Set(applied);
  return [...new Set([...applied, ...learned.filter((id) => !appliedSet.has(id)).map((id) => `!${id}`), ...explore.map((id) => `!${id}`)])];
}
