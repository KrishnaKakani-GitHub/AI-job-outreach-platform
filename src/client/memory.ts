"use client";
/**
 * Writing to the memory log, and re-learning after new outcomes. Every write
 * is best-effort: a failed log entry never blocks the action it describes.
 */
import { uid } from "@/lib/text";
import type { MemoryEntry } from "@/lib/memory";
import { db } from "./db";
import { log } from "./log";

/** Add an entry. Pass a stable `id` for events that may be recorded twice (the second write replaces the first). */
export async function remember(e: Omit<MemoryEntry, "id" | "at" | "refs" | "detail" | "applicationId" | "family"> & Partial<Pick<MemoryEntry, "id" | "refs" | "detail" | "applicationId" | "family" | "at">>): Promise<void> {
  try {
    await db.memory.put({ id: uid(), at: Date.now(), refs: [], detail: "", applicationId: null, family: null, ...e });
  } catch (err) {
    log("memory.write_failed", err);
  }
}

/**
 * Re-learn from the latest outcomes: recompute rule candidates and scores,
 * record new skill versions, and note in the log what changed. Runs after
 * every logged outcome and every stage change that ends or advances an
 * application.
 */
export async function relearn(demo: boolean, why: string): Promise<void> {
  try {
    const { refreshPlaybook, refreshSkills } = await import("./learning");
    const before = await db.skillVersions.filter((v) => v.demo === demo).count();
    await refreshPlaybook(demo);
    await refreshSkills(demo);
    const after = await db.skillVersions.filter((v) => v.demo === demo).count();
    await remember({ demo, kind: "relearn", title: `Re-scored every skill after ${why}`, detail: after > before ? `${after - before} skill${after - before === 1 ? "" : "s"} got a new version.` : "No skill changed." });
  } catch (err) {
    log("memory.relearn_failed", err);
  }
}
