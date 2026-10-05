/**
 * Plain-text resume parsing. Resumes arrive as pasted text, so this is
 * deliberately forgiving: headings are short lines in capitals or a known
 * section name, and bullets are lines that start with a bullet glyph.
 */
import { isBullet, stripBullet } from "./text";

export interface CvLine {
  /** Stable within one parse: `l<index>`. */
  id: string;
  /** The line as written, without the bullet glyph. */
  text: string;
  raw: string;
  bullet: boolean;
  heading: boolean;
  /** Normalized heading of the section the line sits in ("" before the first heading). */
  section: string;
}

export interface ParsedCv {
  lines: CvLine[];
  headings: string[];
  bullets: CvLine[];
}

const KNOWN = /^(summary|professional summary|profile|objective|experience|work experience|professional experience|employment|education|skills|technical skills|core skills|projects|selected projects|certifications|certificates|awards|publications|leadership|activities|volunteering|languages|interests)$/i;

export function isHeading(line: string): boolean {
  const t = line.trim().replace(/:$/, "");
  if (!t || t.length > 40 || isBullet(t)) return false;
  if (KNOWN.test(t)) return true;
  return /^[A-Z][A-Z &/,-]{2,}$/.test(t) && !/\d/.test(t);
}

export function normalizeHeading(h: string): string {
  const t = h.trim().replace(/:$/, "").toLowerCase();
  if (/experience|employment/.test(t)) return "experience";
  if (/education/.test(t)) return "education";
  if (/skill/.test(t)) return "skills";
  if (/project/.test(t)) return "projects";
  if (/summary|profile|objective/.test(t)) return "summary";
  if (/certif/.test(t)) return "certifications";
  return t;
}

export function parseCv(text: string): ParsedCv {
  const out: CvLine[] = [];
  let section = "";
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line) continue;
    const heading = isHeading(line);
    if (heading) section = normalizeHeading(line);
    const bullet = !heading && isBullet(line);
    out.push({ id: `l${i}`, text: bullet ? stripBullet(line) : line, raw: line, bullet, heading, section });
  }
  return { lines: out, headings: out.filter((l) => l.heading).map((l) => l.section), bullets: out.filter((l) => l.bullet) };
}

/** Render lines back to text, keeping bullets as "- ". */
export function renderCv(lines: Pick<CvLine, "text" | "bullet" | "heading">[]): string {
  const parts: string[] = [];
  for (const l of lines) {
    if (l.heading && parts.length) parts.push("");
    parts.push(l.bullet ? `- ${l.text}` : l.text);
  }
  return parts.join("\n");
}
