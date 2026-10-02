/**
 * Shared-ground detector: deterministic overlap between the sender's text and
 * the recipient's profile. Every overlap carries a verbatim quote from both
 * sides, so the UI can show exactly why it was suggested.
 */
import type { SharedGround } from "./schemas";
import { lineContaining } from "./text";

const SCHOOL_RE = /\b((?:[A-Z][a-z][\w.'&-]*[ \t]){1,4}(?:College|University|School|Institute|Academy)(?:[ \t]+of[ \t]+[A-Z][\w-]+(?:[ \t]+[A-Z][\w-]+)?)?|University[ \t]of[ \t][A-Z][\w-]+(?:[ \t][A-Z][\w-]+)?)\b/g;

const CITIES = [
  "New York", "San Francisco", "Seattle", "Boston", "Chicago", "Austin", "Los Angeles", "Denver", "Atlanta",
  "Washington", "Philadelphia", "Oakland", "Palo Alto", "Mountain View", "Brooklyn", "Jersey City", "Princeton",
  "Amsterdam", "London", "Toronto", "Bay Area",
];

const DOMAINS: [string, RegExp][] = [
  ["healthcare", /\b(health ?care|clinical|patient|hospital|medical)\b/i],
  ["fintech and payments", /\b(fintech|payments?|banking|financial infrastructure)\b/i],
  ["AI and machine learning", /\b(ai|artificial intelligence|machine learning|llms?|generative ai|agents?)\b/i],
  ["music", /\b(music|musician|audio)\b/i],
  ["education", /\b(edtech|education technology|learning platform|teaching)\b/i],
  ["data", /\b(data engineering|analytics|data science)\b/i],
];

const GENERIC = new Set(
  ("The I About Experience Education Skills Projects Present Summary Contact Activity Message Connect Follow " +
    "January February March April May June July August September October November December LinkedIn Remote Hybrid " +
    "Python SQL React TypeScript JavaScript Engineer Engineering Manager Product Data Software Analyst Senior Junior " +
    "Inc LLC Team Lead Head Director Founder University College School Institute").split(" "),
);

function schools(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(SCHOOL_RE)) {
    const name = m[1].trim().replace(/\s+/g, " ");
    if (name.split(" ").length < 2) continue;
    out.set(name.toLowerCase(), name);
  }
  return out;
}

function capitalPhrases(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\b([A-Z][a-zA-Z&.-]+(?:[ \t]+(?:of|&|and)?[ \t]*[A-Z][a-zA-Z&.-]+){0,3})\b/g;
  for (const m of text.matchAll(re)) {
    const p = m[1].trim();
    const words = p.split(/\s+/);
    if (words.every((w) => GENERIC.has(w))) continue;
    if (words.length === 1 && (p.length < 5 || GENERIC.has(p))) continue;
    out.set(p.toLowerCase(), p);
  }
  return out;
}

export function detectSharedGround(me: string, recipient: string, max = 4): SharedGround[] {
  const found: SharedGround[] = [];
  const seen = new Set<string>();
  const push = (label: string, kind: SharedGround["kind"]) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    const meQuote = lineContaining(me, label);
    const recipientQuote = lineContaining(recipient, label);
    if (!meQuote || !recipientQuote) return;
    seen.add(key);
    found.push({ label, kind, meQuote, recipientQuote });
  };

  const ms = schools(me);
  const rs = schools(recipient);
  for (const [k, v] of ms) if (rs.has(k)) push(v, "school");

  for (const city of CITIES) {
    const re = new RegExp(`\\b${city}\\b`);
    if (re.test(me) && re.test(recipient)) push(city, "location");
  }

  const mp = capitalPhrases(me);
  const rp = capitalPhrases(recipient);
  for (const [k, v] of mp) {
    if (!rp.has(k) || seen.has(k) || [...seen].some((s) => s.includes(k) || k.includes(s))) continue;
    if (CITIES.some((c) => c.toLowerCase() === k)) continue;
    push(v, "affiliation");
  }

  // Ignore one-word section headers ("Education", "Experience") when matching domains.
  const body = (t: string) => t.split("\n").filter((l) => l.trim().split(/\s+/).length > 2).join("\n");
  for (const [label, re] of DOMAINS) {
    const a = body(me).match(re);
    const b = body(recipient).match(re);
    if (a && b) {
      const meQuote = lineContaining(me, a[0]);
      const recipientQuote = lineContaining(recipient, b[0]);
      if (meQuote && recipientQuote && !seen.has(label)) {
        seen.add(label);
        found.push({ label, kind: "domain", meQuote, recipientQuote });
      }
    }
  }

  const rank: Record<SharedGround["kind"], number> = { school: 0, employer: 1, affiliation: 2, location: 3, domain: 4 };
  return found.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, max);
}
