"use client";
/**
 * Client side of the learning loop: reads local records, builds the
 * "Craft this application" card, keeps the playbook in sync with the latest
 * outcomes, and produces draft guidance. Only rule text and computed
 * evidence strings are ever sent to the server (for rewording), never
 * documents or contact details.
 */
import { craftApplication, draftGuidance, type Craft, type DraftGuidance } from "@/lib/learn";
import { activeRules, ruleCandidates, syncRules, type PlaybookRule, type RuleScope } from "@/lib/playbook";
import { roleFamily } from "@/lib/insights";
import type { Application, FitReport } from "@/lib/schemas";
import { log } from "./log";
import { db, getProfile, type PlaybookRecord } from "./db";

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

export async function buildCraft(app: Pick<Application, "id" | "role" | "seniority" | "jobText"> & { fit: FitReport | null }, demo: boolean): Promise<Craft> {
  const { apps, contacts } = await records(demo);
  const resume = demo ? (await import("@/lib/demo")).DEMO_RESUME : (await getProfile()).resume;
  const rules = await rulesFor(demo, ["resume", "targeting"], roleFamily(app.role));
  return craftApplication({
    targetId: app.id,
    role: app.role,
    seniority: app.seniority,
    fit: app.fit,
    jobText: app.jobText,
    resume,
    apps,
    contacts,
    now: Date.now(),
    rules: rules.map((r) => ({ id: r.key, text: r.text, tier: r.tier })),
  });
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
}
