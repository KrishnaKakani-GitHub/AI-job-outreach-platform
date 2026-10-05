/**
 * Tracker logic: summary strip, filters, follow-up timing and stage moves.
 * Pure functions so the panel stays thin and everything here is unit-tested.
 */
import type { AppSource, AppStage, Application, Contact, OutcomeLog } from "./schemas";
import { reached } from "./insights";

export const DAY = 86_400_000;
export const FOLLOW_UP_DAYS_APP = 7;
export const FOLLOW_UP_DAYS_CONTACT = 3;

const CLOSED: AppStage[] = ["rejected", "withdrawn", "offer"];

export function isClosed(a: Pick<Application, "stage">): boolean {
  return CLOSED.includes(a.stage);
}

export function isActive(a: Pick<Application, "stage">): boolean {
  return a.stage !== "saved" && !isClosed(a);
}

export function isOverdue(a: Pick<Application, "stage" | "followUpAt">, now: number): boolean {
  return !isClosed(a) && a.followUpAt !== null && a.followUpAt < now;
}

export function contactNeedsFollowUp(c: Pick<Contact, "stage" | "history" | "createdAt">, now: number): boolean {
  if (c.stage !== "accepted") return false;
  const last = c.history[c.history.length - 1]?.at ?? c.createdAt;
  return now - last > FOLLOW_UP_DAYS_CONTACT * DAY;
}

export interface TrackerSummary {
  active: number;
  interviews: number;
  referrals: number;
  nextMove: number;
  coverage: { covered: number; applied: number };
}

export function trackerSummary(apps: Application[], contacts: Contact[], now: number): TrackerSummary {
  const applied = apps.filter((a) => a.stage !== "saved");
  const referredApps = new Set(contacts.filter((c) => c.stage === "referral" && c.applicationId).map((c) => c.applicationId));
  const covered = applied.filter((a) => contacts.some((c) => c.applicationId === a.id && !["drafted", "not_contacted"].includes(c.stage))).length;
  return {
    active: apps.filter(isActive).length,
    interviews: apps.filter((a) => reached(a, "interview")).length,
    referrals: apps.filter((a) => a.source === "referral" || referredApps.has(a.id)).length,
    nextMove: apps.filter((a) => isOverdue(a, now)).length + contacts.filter((c) => contactNeedsFollowUp(c, now)).length,
    coverage: { covered, applied: applied.length },
  };
}

export interface AppFilter {
  q: string;
  stage: AppStage | "all" | "open" | "closed";
  source: AppSource | "all";
}

export function filterApplications(apps: Application[], f: AppFilter): Application[] {
  const q = f.q.trim().toLowerCase();
  return apps.filter((a) => {
    if (q && !`${a.role} ${a.company ?? ""} ${a.location ?? ""} ${a.notes}`.toLowerCase().includes(q)) return false;
    if (f.stage === "open" && isClosed(a)) return false;
    if (f.stage === "closed" && !isClosed(a)) return false;
    if (f.stage !== "all" && f.stage !== "open" && f.stage !== "closed" && a.stage !== f.stage) return false;
    if (f.source !== "all" && a.source !== f.source) return false;
    return true;
  });
}

export function filterContacts(contacts: Contact[], q: string, stage: string): Contact[] {
  const s = q.trim().toLowerCase();
  return contacts.filter((c) => {
    if (s && !`${c.firstName ?? ""} ${c.lastName ?? ""} ${c.title ?? ""} ${c.company ?? ""}`.toLowerCase().includes(s)) return false;
    if (stage !== "all" && c.stage !== stage) return false;
    return true;
  });
}

/** Move an application to a new stage, keeping history and setting applied/follow-up dates. */
export function moveApplication(a: Application, stage: AppStage, now: number): Application {
  if (stage === a.stage) return a;
  const next: Application = { ...a, stage, history: [...a.history, { stage, at: now }] };
  if (stage !== "saved" && next.appliedAt === null) next.appliedAt = now;
  if (stage === "applied" && next.followUpAt === null) {
    next.followUpAt = now + FOLLOW_UP_DAYS_APP * DAY;
    next.nextStep ??= "Follow up if there's no response";
  }
  if (isClosed(next)) next.followUpAt = null;
  return next;
}

/** Apply a logged outcome: closes the application for rejections, offers and withdrawals. */
export function applyOutcome(a: Application, o: OutcomeLog, now: number): Application {
  const target: AppStage | null = o.result === "rejected" ? "rejected" : o.result === "offer" ? "offer" : o.result === "withdrawn" ? "withdrawn" : null;
  const moved = target ? moveApplication(a, target, now) : a;
  return { ...moved, outcome: o, followUpAt: o.result === "no_response" ? null : moved.followUpAt };
}

export function displayName(c: Pick<Contact, "firstName" | "lastName">): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unnamed contact";
}
