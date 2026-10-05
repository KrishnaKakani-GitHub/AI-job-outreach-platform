/** Small text helpers shared by the rule-based engines. */

export const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have in is it its of on or that the to with you your we our will this " +
    "their they who what when where which while into across within about able ability strong excellent good great " +
    "work working experience experiences years year plus including include such using use etc other others more " +
    "least one two three new team teams role candidate ideal skills skill knowledge understanding familiarity " +
    "preferred required requirement requirements must nice bonus would should can may also well both"
  ).split(" "),
);

/** Verbs and generic words that show up in requirements but aren't skills you can show. Stemmed. */
export const GENERIC_TERMS: Set<string> = new Set(
  "own run analyze build work communicate communication decision decisions clear clearly write strong end-to-end ship lead independent independently reliable define use data insight insights stakeholder stakeholders business cross-functional partner collaborate"
    .split(" ")
    .map((w) => (w.length <= 4 ? w : w.replace(/(ing|ed|es|s|ly|ment|ation|ations)$/, "") || w)),
);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9+#.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content-bearing tokens, lightly stemmed so "analyzing" ≈ "analyze". */
export function keywords(s: string): string[] {
  const out: string[] = [];
  for (const raw of normalize(s).split(/[\s/]+/)) {
    const t = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (t.length < 2 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    out.push(stem(t));
  }
  return out;
}

export function stem(t: string): string {
  if (t.length <= 4) return t;
  return t.replace(/(ing|ed|es|s|ly|ment|ation|ations)$/, "") || t;
}

export function lines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

const BULLET = /^([-•*·▪●◦–]|\d+[.)])\s+/;

export function isBullet(line: string): boolean {
  return BULLET.test(line);
}

export function stripBullet(line: string): string {
  return line.replace(BULLET, "").trim();
}

export function hasNumber(s: string): boolean {
  return /\d/.test(s);
}

/** Case-insensitive, whitespace-tolerant containment used by the grounding check. */
export function containsLoose(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/\s+/g, " ");
  const n = needle.toLowerCase().replace(/\s+/g, " ").trim();
  return n.length > 0 && h.includes(n);
}

/** Find the line in `text` that contains `needle` (for hover-to-source quotes). */
export function lineContaining(text: string, needle: string): string | null {
  const n = needle.toLowerCase();
  for (const l of lines(text)) if (l.toLowerCase().includes(n)) return l;
  return null;
}

export function overlapRatio(a: string[], b: Set<string>): number {
  if (a.length === 0) return 0;
  let hit = 0;
  for (const t of new Set(a)) if (b.has(t)) hit++;
  return hit / new Set(a).size;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function firstWord(s: string | null | undefined): string | null {
  if (!s) return null;
  const w = s.trim().split(/\s+/)[0];
  return w && /^[A-Z][a-zA-Z'-]+$/.test(w) ? w : null;
}
