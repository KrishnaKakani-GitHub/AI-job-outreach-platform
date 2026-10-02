"use client";
/**
 * Anonymous experiment identity and event reporting. The anonymous ID is a
 * random UUID; it is never linked to the profile or to any pasted text.
 */
import { assignVariant, EXPERIMENT } from "@/lib/ab";
import type { ExperimentEvent } from "@/lib/schemas";

const KEY = "wi-anon-id";

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable (private mode); fall back to a per-tab ID */
  }
}

let memoryId: string | null = null;
export function anonId(): string {
  const existing = safeGet(KEY) ?? memoryId;
  if (existing) return existing;
  const id = crypto.randomUUID().toLowerCase();
  memoryId = id;
  safeSet(KEY, id);
  return id;
}

/** Allows ?variant=A or ?variant=B for demos and screenshots; never recorded as an event. */
export function forcedVariant(): "A" | "B" | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("variant");
  return v === "A" || v === "B" ? v : null;
}

export function myVariant(): "A" | "B" {
  return forcedVariant() ?? assignVariant(anonId());
}

export function trackingEnabled(): boolean {
  return forcedVariant() === null && safeGet("wi-demo") !== "1";
}

export async function track(type: ExperimentEvent["type"], value: number | null = null): Promise<void> {
  if (!trackingEnabled()) return;
  if (type === "exposure") {
    if (safeGet("wi-exposed") === "1") return;
    safeSet("wi-exposed", "1");
  }
  const event: ExperimentEvent = { anonId: anonId(), experiment: EXPERIMENT, variant: myVariant(), type, value };
  try {
    await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: [event] }), keepalive: true });
  } catch {
    /* analytics must never break the product */
  }
}

export const prefs = {
  get: safeGet,
  set: safeSet,
};
