/**
 * The memory log: an append-only record of what the app drafted, what you
 * sent, which insights went onto each resume, what happened, and what the
 * skills learned from it. It lives in your browser; nothing here is sent to
 * the server. Re-learning reads outcomes and rules from the tracker; the log
 * is the readable history of why each skill changed.
 */
export const MEMORY_KINDS = [
  "message_drafted",
  "message_sent",
  "cv_kept",
  "applied",
  "interview",
  "outcome",
  "rule_proposed",
  "rule_accepted",
  "rule_dismissed",
  "skill_version",
  "relearn",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryEntry {
  id: string;
  demo: boolean;
  at: number;
  kind: MemoryKind;
  applicationId: string | null;
  /** Job type label, when the entry is about one application. */
  family: string | null;
  title: string;
  /** Full text where it matters (the message, the resume, the notes). Local only. */
  detail: string;
  /** Rule ids involved: learned/... or <skill>/<rule>. */
  refs: string[];
}

export const MEMORY_GROUPS: { label: string; kinds: MemoryKind[] }[] = [
  { label: "Messages", kinds: ["message_drafted", "message_sent"] },
  { label: "Resumes", kinds: ["cv_kept", "applied"] },
  { label: "Interviews and outcomes", kinds: ["interview", "outcome"] },
  { label: "Learning", kinds: ["rule_proposed", "rule_accepted", "rule_dismissed", "skill_version", "relearn"] },
];

/**
 * How confident the analysis gets as history grows. Analysis itself runs from
 * the first outcome; milestones only mark when results firm up.
 */
export const MILESTONES: { at: number; unlocks: string }[] = [
  { at: 1, unlocks: "personal analysis starts, labelled as an early signal" },
  { at: 15, unlocks: "patterns across all your applications" },
  { at: 50, unlocks: "patterns inside your main job types" },
  { at: 200, unlocks: "strong comparisons for common advice across all roles (30 in each group)" },
  { at: 500, unlocks: "strong patterns inside your main job types" },
];

export function nextMilestone(outcomes: number): { at: number; unlocks: string } | null {
  return MILESTONES.find((m) => m.at > outcomes) ?? null;
}

/** Only the rules an application actually followed (drops "!id" entries). */
export function followedRefs(trace: readonly string[] | null | undefined): string[] {
  return (trace ?? []).filter((x) => !x.startsWith("!"));
}

/** Plain-text export, one entry per block, newest first. */
export function memoryToText(entries: MemoryEntry[]): string {
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .map((e) => [`${new Date(e.at).toISOString()} · ${e.kind}${e.family ? ` · ${e.family}` : ""}`, e.title, e.detail, e.refs.length ? `Rules: ${e.refs.join(", ")}` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
}

/**
 * Memory entries reconstructed from records (used for demo data, where there
 * was no live session to log): one per application sent, interview, and outcome.
 */
export function memoryFromRecords(apps: { id: string; demo: boolean; role: string; company: string | null; appliedAt: number | null; history: { stage: string; at: number }[]; cv: { tailored: boolean; rules: string[] } | null; trace: string[] | null; outcome: { at: number; result: string; notes: string; learning: string } | null }[], familyOf: (a: { role: string }) => string, ruleText: (id: string) => string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const a of apps) {
    const refs = [...followedRefs(a.cv?.rules), ...followedRefs(a.trace)];
    const insights = refs.map(ruleText).join("\n");
    const name = `${a.role}${a.company ? ` at ${a.company}` : ""}`;
    const base = { demo: a.demo, applicationId: a.id, family: familyOf(a), refs };
    if (a.appliedAt) out.push({ ...base, id: `${a.id}-applied`, at: a.appliedAt, kind: "applied", title: `Applied: ${name}${a.cv?.tailored ? " with a tailored resume" : ""}`, detail: insights });
    const iv = a.history.find((h) => h.stage === "interview");
    if (iv) out.push({ ...base, id: `${a.id}-interview`, at: iv.at, kind: "interview", title: `Interview: ${name}. What was on the resume you sent`, detail: insights });
    if (a.outcome) out.push({ ...base, id: `${a.id}-outcome`, at: a.outcome.at, kind: "outcome", title: `Outcome: ${name}, ${a.outcome.result.replace("_", " ")}`, detail: [a.outcome.notes && `What happened: ${a.outcome.notes}`, a.outcome.learning && `What I'd change: ${a.outcome.learning}`].filter(Boolean).join("\n") });
  }
  return out;
}
