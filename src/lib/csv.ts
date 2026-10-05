/**
 * CSV parsing and writing (RFC 4180: quoted fields, escaped quotes, CRLF,
 * newlines inside quotes) plus the two concrete formats the tracker reads:
 * LinkedIn's Connections.csv export and an applications CSV.
 */
import { APP_SOURCES, APP_STAGES, type AppSource, type AppStage, type Application } from "./schemas";
import type { ApplicationInput } from "./records";

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function escape(raw: string): string {
  // Neutralize spreadsheet formulas (CSV injection) in user-entered text.
  const v = /^[=+\-@\t]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCSV(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((c) => escape(c === null ? "" : String(c))).join(",")).join("\r\n");
}

// ---- LinkedIn Connections.csv ----

export interface LinkedInConnection {
  firstName: string;
  lastName: string;
  url: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
}

/**
 * LinkedIn's export starts with a few "Notes:" lines before the header row.
 * Email addresses are deliberately ignored: they aren't needed and are the
 * most sensitive column in the file.
 */
export function parseLinkedInConnections(text: string): { ok: true; rows: LinkedInConnection[] } | { ok: false; error: string } {
  const rows = parseCSV(text);
  const h = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === "first name") && r.some((c) => c.trim().toLowerCase() === "last name"));
  if (h < 0) return { ok: false, error: "Couldn't find the First Name / Last Name header. Upload the Connections.csv file from LinkedIn's data export." };
  const header = rows[h].map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [fi, li, ui, ci, pi, di] = [col("first name"), col("last name"), col("url"), col("company"), col("position"), col("connected on")];
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const out: LinkedInConnection[] = [];
  for (const r of rows.slice(h + 1)) {
    const firstName = get(r, fi);
    const lastName = get(r, li);
    if (!firstName && !lastName) continue;
    out.push({
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      url: get(r, ui) || null,
      company: get(r, ci).slice(0, 200) || null,
      position: get(r, pi).slice(0, 200) || null,
      connectedOn: get(r, di).slice(0, 40) || null,
    });
  }
  return { ok: true, rows: out };
}

/** Same person if the LinkedIn URL matches, or (no URL) the full name and company match. */
export function connectionKey(c: { firstName: string | null; lastName: string | null; company: string | null; linkedinUrl?: string | null; url?: string | null }): string {
  const url = (c.linkedinUrl ?? c.url ?? "").trim().toLowerCase().replace(/\/+$/, "");
  if (url) return `url:${url}`;
  return `name:${(c.firstName ?? "").trim().toLowerCase()}|${(c.lastName ?? "").trim().toLowerCase()}|${(c.company ?? "").trim().toLowerCase()}`;
}

// ---- Applications CSV ----

export const APP_CSV_HEADER = ["company", "role", "stage", "applied_date", "source", "location", "job_url", "resume_version", "next_step", "notes"] as const;

function isoDate(ts: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "";
}

export function applicationsToCSV(apps: Application[]): string {
  return toCSV([
    [...APP_CSV_HEADER],
    ...apps.map((a) => [a.company ?? "", a.role, a.stage, isoDate(a.appliedAt), a.source, a.location ?? "", a.jobUrl ?? "", a.resumeVersion, a.nextStep ?? "", a.notes]),
  ]);
}

/** Parse an applications CSV. Unknown stages/sources fall back to safe defaults; rows without a role are skipped and reported. */
export function parseApplicationsCSV(
  text: string,
  makeId: () => string,
  now = Date.now(),
): { ok: true; rows: ApplicationInput[]; skipped: number } | { ok: false; error: string } {
  const rows = parseCSV(text);
  if (!rows.length) return { ok: false, error: "The file is empty." };
  const header = rows[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  if (col("role") < 0) return { ok: false, error: "The CSV needs at least a 'role' column. Export one from the tracker to see the expected format." };
  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  let skipped = 0;
  const out: ApplicationInput[] = [];
  for (const r of rows.slice(1)) {
    const role = get(r, "role").slice(0, 200);
    if (!role) {
      skipped++;
      continue;
    }
    const stageRaw = get(r, "stage").toLowerCase().replace(/\s+/g, "_");
    const stage: AppStage = (APP_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as AppStage) : "applied";
    const sourceRaw = get(r, "source").toLowerCase();
    const source: AppSource = (APP_SOURCES as readonly string[]).includes(sourceRaw) ? (sourceRaw as AppSource) : "cold";
    const applied = Date.parse(get(r, "applied_date"));
    const appliedAt = Number.isFinite(applied) ? applied : null;
    const createdAt = appliedAt ?? now;
    out.push({
      id: makeId(),
      createdAt,
      role,
      company: get(r, "company").slice(0, 200) || null,
      stage,
      history: [{ stage: "saved", at: createdAt }, ...(stage !== "saved" ? [{ stage, at: createdAt }] : [])],
      source,
      appliedAt: stage === "saved" ? null : appliedAt ?? createdAt,
      location: get(r, "location").slice(0, 200) || null,
      jobUrl: get(r, "job_url").slice(0, 2000) || null,
      resumeVersion: get(r, "resume_version").slice(0, 40) || "v1",
      nextStep: get(r, "next_step").slice(0, 300) || null,
      notes: get(r, "notes").slice(0, 5000),
    });
  }
  return { ok: true, rows: out, skipped };
}
