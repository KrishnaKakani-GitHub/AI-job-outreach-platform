/**
 * Experiment event store. Uses Neon Postgres when DATABASE_URL is set,
 * otherwise an in-process store (fine for local dev; not durable on serverless).
 * Only anonymous IDs, variant labels, event types and small numbers are stored.
 */
import { neon } from "@neondatabase/serverless";
import type { ExperimentEvent } from "@/lib/schemas";
import { log } from "./log";

export interface ArmSummary {
  variant: "A" | "B";
  exposed: number;
  drafted: number;
  copied: number;
  medianSecondsToCopy: number | null;
  meanEditRatio: number | null;
}

type Row = ExperimentEvent & { at: number };
const g = globalThis as unknown as { __wiEvents?: Row[] };
const memory = (g.__wiEvents ??= []);

let ready: Promise<void> | null = null;
function sql() {
  return neon(process.env.DATABASE_URL!);
}
async function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await sql()`CREATE TABLE IF NOT EXISTS experiment_events (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      anon_id TEXT NOT NULL,
      experiment TEXT NOT NULL,
      variant CHAR(1) NOT NULL,
      type TEXT NOT NULL,
      value DOUBLE PRECISION
    )`;
    await sql()`CREATE INDEX IF NOT EXISTS experiment_events_exp ON experiment_events (experiment, type)`;
  })();
  return ready;
}

export function persistence(): "postgres" | "memory" {
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export async function recordEvent(e: ExperimentEvent): Promise<void> {
  if (persistence() === "memory") {
    memory.push({ ...e, at: Date.now() });
    if (memory.length > 50_000) memory.shift();
    return;
  }
  await ensureTable();
  await sql()`INSERT INTO experiment_events (anon_id, experiment, variant, type, value) VALUES (${e.anonId}, ${e.experiment}, ${e.variant}, ${e.type}, ${e.value})`;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Time of the first recorded exposure (when the experiment actually started), or null. */
export async function startedAt(experiment: string): Promise<number | null> {
  if (persistence() === "memory") {
    const first = memory.find((r) => r.experiment === experiment && r.type === "exposure");
    return first?.at ?? null;
  }
  await ensureTable();
  const rows = (await sql()`SELECT EXTRACT(EPOCH FROM MIN(at)) * 1000 AS t FROM experiment_events WHERE experiment = ${experiment} AND type = 'exposure'`) as { t: number | string | null }[];
  const t = rows[0]?.t;
  return t === null || t === undefined ? null : Number(t);
}

/** Per-arm unique-user counts. A user counts once per event type. */
export async function summarize(experiment: string): Promise<ArmSummary[]> {
  let rows: { anon_id: string; variant: string; type: string; value: number | null }[];
  if (persistence() === "memory") {
    rows = memory.filter((r) => r.experiment === experiment).map((r) => ({ anon_id: r.anonId, variant: r.variant, type: r.type, value: r.value }));
  } else {
    await ensureTable();
    rows = (await sql()`SELECT anon_id, variant, type, value FROM experiment_events WHERE experiment = ${experiment}`) as typeof rows;
  }
  // Attribute each user to the variant of their first exposure (guards against cookie resets).
  const firstVariant = new Map<string, string>();
  for (const r of rows) if (r.type === "exposure" && !firstVariant.has(r.anon_id)) firstVariant.set(r.anon_id, r.variant);
  const out: ArmSummary[] = [];
  for (const v of ["A", "B"] as const) {
    const users = (type: string) => new Set(rows.filter((r) => r.type === type && firstVariant.get(r.anon_id) === v).map((r) => r.anon_id));
    const copyRows = rows.filter((r) => r.type === "copied" && firstVariant.get(r.anon_id) === v && r.value !== null);
    const editRows = rows.filter((r) => r.type === "edited" && firstVariant.get(r.anon_id) === v && r.value !== null);
    out.push({
      variant: v,
      exposed: users("exposure").size,
      drafted: users("draft_generated").size,
      copied: users("copied").size,
      medianSecondsToCopy: median(copyRows.map((r) => r.value!)),
      meanEditRatio: editRows.length ? editRows.reduce((s, r) => s + r.value!, 0) / editRows.length : null,
    });
  }
  log("info", "results.summarized", { experiment, persistence: persistence(), rows: rows.length });
  return out;
}
