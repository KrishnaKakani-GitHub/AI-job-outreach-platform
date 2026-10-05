"use client";
/**
 * Client side of the learning loop: reads local records, builds the
 * "Craft this application" card, keeps the playbook in sync with the latest
 * outcomes, and produces draft guidance. Only rule text and computed
 * evidence strings are ever sent to the server (for rewording), never
 * documents or contact details.
 */
import { craftApplication, draftGuidance, outreachChains, type Craft, type DraftGuidance } from "@/lib/learn";
import { activeRules, ruleCandidates, syncRules, type PlaybookRule, type RuleScope } from "@/lib/playbook";
import { familyOf } from "@/lib/insights";
import { jobTypeProfiles, jobTypeRecos, overallRate, profileFacts, profileFor, ruleRecos } from "@/lib/jobtypes";
import type { Application, FitReport } from "@/lib/schemas";
import { SKILL_IDS, type SkillUse } from "@/lib/skills/catalog";
export { freezeCv, signedRules } from "@/lib/skills/freeze";
import { diffItems, learnedTargets, personalSkills, ruleSkill, skillContext, type PersonalSkill } from "@/lib/skills/personal";
import { scoreAll, type RuleScore } from "@/lib/skills/score";
import type { SkillContext } from "@/lib/skills/context";
import { log } from "./log";
import { remember } from "./memory";
import { learnedId } from "@/lib/playbook";
import { db, getProfile, type PlaybookRecord, type SkillVersionRecord } from "./db";

export async function records(demo: boolean) {
  const [apps, contacts] = await Promise.all([db.applications.filter((a) => a.demo === demo).toArray(), db.contacts.filter((c) => c.demo === demo).toArray()]);
  return { apps, contacts };
}

async function storedRules(demo: boolean): Promise<PlaybookRecord[]> {
  return db.playbook.filter((r) => r.demo === demo).toArray();
}

export async function rulesFor(demo: boolean, scopes: RuleScope[], family: string | null): Promise<PlaybookRule[]> {
  return activeRules(await storedRules(demo), scopes, family);
}

export async function buildCraft(app: Pick<Application, "id" | "role" | "seniority" | "jobText" | "jobType"> & { fit: FitReport | null }, demo: boolean): Promise<Craft> {
  const { apps, contacts } = await records(demo);
  const resume = await resumeFor(demo);
  const family = familyOf(app);
  const rules = await rulesFor(demo, ["resume", "targeting"], family);
  const now = Date.now();
  const others = apps.filter((a) => a.id !== app.id);
  const profile = profileFor(jobTypeProfiles(others, now), family);
  const scores = scoreAll(others, contacts, now, learnedTargets(await storedRules(demo)));
  const extra = [...jobTypeRecos(profile, { jobText: app.jobText, fit: app.fit, resume }, overallRate(others, now)), ...ruleRecos(scores, family)];
  const craft = craftApplication({
    targetId: app.id,
    role: app.role,
    jobType: app.jobType,
    seniority: app.seniority,
    fit: app.fit,
    jobText: app.jobText,
    resume,
    apps,
    contacts,
    now: Date.now(),
    rules: rules.map((r) => ({ id: r.key, text: r.text, tier: r.tier })),
  });
  return { ...craft, recos: [...craft.recos, ...extra] };
}

export async function guidanceFor(demo: boolean, sharedKinds: string[]): Promise<DraftGuidance | null> {
  const { contacts } = await records(demo);
  const rules = (await rulesFor(demo, ["message"], null)).map((r) => r.text);
  // Seeded per draft so the bandit's choice is reproducible in logs but varies between drafts.
  const seed = (Date.now() ^ (contacts.length << 8)) >>> 0;
  return draftGuidance(contacts, sharedKinds, Date.now(), seed, rules);
}

/** Recompute candidate rules, merge with the user's decisions, and reword new ones. */
export async function refreshPlaybook(demo: boolean): Promise<PlaybookRecord[]> {
  const { apps, contacts } = await records(demo);
  const now = Date.now();
  const stored = await storedRules(demo);
  const merged = syncRules(stored, ruleCandidates(apps, contacts, now), now).map((r) => ({ ...r, id: `${demo ? "demo" : "real"}|${r.key}`, demo }));
  await db.playbook.bulkPut(merged);

  const toWord = merged.filter((r) => r.current && r.status !== "rejected" && r.source === "rules");
  if (toWord.length) {
    try {
      const res = await fetch("/api/ai/playbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: toWord.slice(0, 20).map((r) => ({ key: r.key, text: r.text, evidence: r.evidence })) }),
      });
      if (res.ok) {
        const out = (await res.json()) as { rules: { key: string; text: string; source: "ai" | "rules" }[] };
        const ai = out.rules.filter((r) => r.source === "ai");
        for (const r of ai) {
          const id = `${demo ? "demo" : "real"}|${r.key}`;
          await db.playbook.update(id, { text: r.text, source: "ai" });
        }
      }
    } catch (e) {
      // Wording is a nicety; the code-written rules are already stored.
      log("playbook.reword_failed", e);
    }
  }
  return storedRules(demo);
}

export async function setRuleStatus(id: string, status: PlaybookRule["status"]): Promise<void> {
  await db.playbook.update(id, { status, updatedAt: Date.now() });
  const r = await db.playbook.get(id);
  if (r && status !== "proposed") {
    await remember({
      demo: r.demo,
      kind: status === "accepted" ? "rule_accepted" : "rule_dismissed",
      family: r.family,
      title: `${status === "accepted" ? "Accepted" : "Dismissed"}: ${r.text}`,
      detail: r.evidence,
      refs: [learnedId(r.key)],
    });
  }
}

// ---- Skills ----

/** The resume to tailor and check: yours if saved; in demo mode without one, the synthetic resume. */
export async function resumeFor(demo: boolean): Promise<string> {
  const mine = (await getProfile()).resume;
  return mine || (demo ? (await import("@/lib/demo")).DEMO_RESUME_V2 : "");
}

/** Scores for every baseline rule and every accepted learned rule. */
export async function ruleScores(demo: boolean): Promise<RuleScore[]> {
  const { apps, contacts } = await records(demo);
  return scoreAll(apps, contacts, Date.now(), learnedTargets(await storedRules(demo)));
}

export interface SkillView extends PersonalSkill<PlaybookRecord> {
  version: number;
  history: SkillVersionRecord[];
}

/**
 * Recompute every personal skill and record a new version for any skill whose
 * learned part changed. Version 0 is the untouched baseline.
 */
export async function refreshSkills(demo: boolean): Promise<SkillView[]> {
  const rules = await storedRules(demo);
  const scores = await ruleScores(demo);
  const skills = personalSkills(rules, scores);
  const all = await db.skillVersions.filter((v) => v.demo === demo).toArray();
  const out: SkillView[] = [];
  for (const p of skills) {
    const history = all.filter((v) => v.skillId === p.id).sort((a, b) => a.version - b.version);
    const last = history[history.length - 1];
    if ((last && last.signature !== p.signature) || (!last && p.signature !== "baseline")) {
      const rec: SkillVersionRecord = {
        id: `${demo ? "demo" : "real"}|${p.id}|${(last?.version ?? 0) + 1}`,
        demo,
        skillId: p.id,
        version: (last?.version ?? 0) + 1,
        signature: p.signature,
        items: p.items,
        changes: diffItems(last?.items ?? [], p.items),
        createdAt: Date.now(),
      };
      await db.skillVersions.put(rec);
      await remember({ id: `skill-version|${rec.id}`, demo, kind: "skill_version", title: `${p.name}: personal version ${rec.version}`, detail: rec.changes.join("\n") || "First personal version." });
      history.push(rec);
    }
    out.push({ ...p, version: history[history.length - 1]?.version ?? 0, history });
  }
  return out;
}

export async function skillVersions(demo: boolean): Promise<Record<string, number>> {
  const all = await db.skillVersions.filter((v) => v.demo === demo).toArray();
  const out: Record<string, number> = {};
  for (const id of SKILL_IDS) out[id] = Math.max(0, ...all.filter((v) => v.skillId === id).map((v) => v.version));
  return out;
}

/** The skill context for one AI request about one application (or none). */
export async function contextFor(use: SkillUse, app: Pick<Application, "role" | "jobType"> | null, demo: boolean): Promise<SkillContext> {
  const { apps, contacts } = await records(demo);
  const now = Date.now();
  const rules = await storedRules(demo);
  const family = app ? familyOf(app) : null;
  const profile = family ? profileFor(jobTypeProfiles(apps, now), family) : null;
  const chains = outreachChains(apps, contacts, now)
    .filter((c) => c.outcome === "success")
    .slice(0, 3)
    .map((c) => `${c.role}: ${c.steps.join(" → ")}`);
  const scores = scoreAll(apps, contacts, now, learnedTargets(rules));
  const worked = family ? ruleRecos(scores, family).map((r) => `${r.title}: ${r.advice} (${r.why})`) : [];
  return skillContext({
    use,
    family,
    rules,
    scores,
    profile: [...(profile && profile.tier !== "job_post" ? profileFacts(profile) : []), ...worked],
    chains: use === "draft" || use === "tailor" ? chains : [],
    versions: await skillVersions(demo),
    seed: (now ^ (apps.length << 4)) >>> 0,
  });
}

/**
 * What accepted rules say to keep near the top: resume lines your successful
 * outreach led with, and requirement terms that went with responses for this job type.
 */
export async function leadBoosts(demo: boolean, family: string): Promise<string[]> {
  const rules = (await storedRules(demo)).filter((r) => r.status === "accepted" && r.current && (r.key.startsWith("lead|") || r.key.startsWith("cover|")) && (r.family === null || r.family === family));
  return rules.map((r) => r.text.match(/"([^"]+)"/)?.[1] ?? "").filter(Boolean);
}

/** Ask the AI to turn outcome notes into proposed rules; store them for the user to accept or dismiss. */
export async function refreshNoteRules(demo: boolean): Promise<{ proposed: number; error: string | null }> {
  const { apps } = await records(demo);
  const withNotes = apps.filter((a) => a.outcome && (a.outcome.notes.trim() || a.outcome.learning.trim())).slice(-25);
  if (!withNotes.length) return { proposed: 0, error: null };
  const stored = await storedRules(demo);
  try {
    const res = await fetch("/api/ai/notes-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notes: withNotes.map((a) => ({
          appId: a.id,
          family: familyOf(a),
          result: a.outcome!.result,
          reason: a.outcome!.reasonCategory,
          reasonSource: a.outcome!.reasonSource,
          notes: a.outcome!.notes,
          learning: a.outcome!.learning,
        })),
        existing: stored.filter((r) => r.status !== "rejected").map((r) => r.text).slice(0, 40),
      }),
    });
    if (!res.ok) return { proposed: 0, error: "Couldn't read your notes right now." };
    const out = (await res.json()) as { rules: { key: string; skill: PlaybookRule["skill"]; family: string | null; text: string; appIds: string[] }[]; source: "ai" | "rules" };
    if (out.source === "rules") return { proposed: 0, error: "Turning notes into rules needs the AI, which isn't configured." };
    const now = Date.now();
    const known = new Set(stored.map((r) => r.key));
    const fresh: PlaybookRecord[] = out.rules
      .filter((r) => !known.has(r.key))
      .map((r) => ({
        id: `${demo ? "demo" : "real"}|${r.key}`,
        demo,
        key: r.key,
        scope: r.skill === "cold-email-writer" ? "message" : r.skill === "job-description-analyzer" ? "targeting" : "resume",
        family: r.family,
        text: r.text,
        evidence: `From your notes on ${r.appIds.length} application${r.appIds.length === 1 ? "" : "s"}.`,
        tier: "notes",
        skill: r.skill,
        origin: "notes",
        appIds: r.appIds,
        status: "proposed",
        current: true,
        source: "ai",
        createdAt: now,
        updatedAt: now,
      }));
    await db.playbook.bulkPut(fresh);
    for (const r of fresh) await remember({ id: `proposed|${r.id}`, demo, kind: "rule_proposed", family: r.family, title: `Proposed from your notes: ${r.text}`, detail: r.evidence, refs: [learnedId(r.key)] });
    return { proposed: fresh.length, error: null };
  } catch (e) {
    log("notes_rules.failed", e);
    return { proposed: 0, error: "Couldn't read your notes right now." };
  }
}

export { ruleSkill };

const baselineCache = new Map<string, string>();

async function fetchBaseline(id: string): Promise<string> {
  const hit = baselineCache.get(id);
  if (hit) return hit;
  const res = await fetch(`/api/skills?id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Couldn't load the ${id} baseline skill.`);
  const out = (await res.json()) as { markdown: string };
  baselineCache.set(id, out.markdown);
  return out.markdown;
}

/** The full personal SKILL.md for one skill, as it would be uploaded to Claude. */
export async function personalMarkdown(view: SkillView): Promise<string> {
  const { personalSkillMarkdown } = await import("@/lib/skills/personal");
  return personalSkillMarkdown(view, await fetchBaseline(view.id), view.version, new Date().toISOString().slice(0, 10));
}

/** Zip personal skills as one folder per skill (<id>-personal/SKILL.md) and download it. */
export async function exportSkills(views: SkillView[], filename: string): Promise<void> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const v of views) files[`${v.id}-personal/SKILL.md`] = strToU8(await personalMarkdown(v));
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped.slice().buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
