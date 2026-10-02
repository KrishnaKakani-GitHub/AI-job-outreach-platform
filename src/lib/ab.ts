/**
 * Deterministic A/B assignment. The same anonymous ID always lands in the same
 * arm for a given experiment, so refreshes and return visits are consistent.
 */
export const EXPERIMENT = "draft_v1";

/** 32-bit FNV-1a hash. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function assignVariant(anonId: string, experiment = EXPERIMENT): "A" | "B" {
  return fnv1a(`${experiment}:${anonId}`) % 2 === 0 ? "A" : "B";
}

/** Normalized edit distance (Levenshtein / max length), used as a guardrail metric. */
export function editRatio(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 1;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n] / Math.max(m, n);
}
