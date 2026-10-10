/**
 * Rule-based document classifier and metadata extraction. This is the
 * deterministic baseline: the AI may propose a different label, but the UI
 * always shows a correctable chip, and these rules run when no API key is set.
 */
import type { CompanyType, DocKind, JobMeta, RecipientMeta, RecipientType, Seniority } from "./schemas";
import { isBullet, lines, stripBullet } from "./text";

const GREETING = /^\s*(hi|hello|dear)\s+[A-Z]/m;
const SIGNOFF = /\b(best|thanks|regards|sincerely|best regards|kind regards),?\s*$/im;

const SIGNALS: Record<Exclude<DocKind, "other">, RegExp[]> = {
  job_description: [
    /\b(responsibilities|qualifications|requirements|what you'?ll do|what you'?ll bring|about the role|who you are)\b/i,
    /\b(we'?re looking for|we are looking for|you will|the ideal candidate|nice to have|preferred qualifications)\b/i,
    /\b(benefits|salary|compensation|equal opportunity|apply now|hybrid|on-?site|remote)\b/i,
    /\b(\d\+?\s*(years|yrs))\b/i,
  ],
  resume: [
    /^\s*(education|experience|work experience|skills|projects|relevant experience|technical skills)\s*:?\s*$/im,
    /\b(b\.?s\.?|b\.?a\.?|m\.?s\.?|bachelor|master|gpa)\b/i,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\s*[-–]\s*/i,
    /\b(led|built|designed|developed|implemented|reduced|increased|improved)\b/i,
  ],
  recipient_profile: [
    /\b(about|activity|followers|connections|500\+)\b/i,
    /·\s*(1st|2nd|3rd)\b|\b(1st|2nd|3rd)\s+degree\b/i,
    /\b(message|connect|follow|open to work|hiring)\b/i,
    /\s\|\s|\bat\s+[A-Z]/,
  ],
  background: [/\b(i'?m|i am|my|i have|i've)\b/i],
  message: [
    GREETING,
    SIGNOFF,
    /\bthank you for (your interest|applying|your application|taking the time|considering)\b/i,
    /\b(other candidates|not (to )?(move|moving) forward|decided to (pursue|proceed|move forward) with|unfortunately|regret to inform|keep your (resume|application) on file)\b/i,
  ],
};

export interface Classification {
  kind: DocKind;
  confidence: number;
  scores: Record<string, number>;
  /** True when the top two labels are too close (or the best is too weak) to act on without asking. */
  ambiguous: boolean;
}

/** Below this, or with the runner-up within AMBIGUOUS_GAP, the app asks instead of acting. */
export const MIN_CONFIDENCE = 0.4;
export const AMBIGUOUS_GAP = 0.05;

export function classifyDocument(text: string): Classification {
  const t = text.trim();
  const scores: Record<string, number> = {};
  for (const [kind, patterns] of Object.entries(SIGNALS)) {
    scores[kind] = patterns.reduce((acc, re) => acc + (re.test(t) ? 1 : 0), 0) / patterns.length;
  }
  const len = t.length;
  // Length priors: backgrounds are short, resumes and JDs are long.
  if (len < 600) {
    scores.background += 0.35;
    scores.resume -= 0.3;
    scores.job_description -= 0.15;
  }
  if (len > 1500) scores.background -= 0.6;
  if (/^\s*(hi|hello|dear)\b/i.test(t)) scores.background -= 0.3;
  // A greeting plus a sign-off is an email or note, not a LinkedIn profile.
  if (GREETING.test(t) && SIGNOFF.test(t)) {
    scores.message += 0.3;
    scores.recipient_profile -= 0.2;
  }

  let kind: DocKind = "other";
  let best = 0.24;
  for (const [k, v] of Object.entries(scores)) {
    if (v > best) {
      best = v;
      kind = k as DocKind;
    }
  }
  const runnerUp = Math.max(...Object.entries(scores).filter(([k]) => k !== kind).map(([, v]) => v));
  const ambiguous = kind === "other" || best < MIN_CONFIDENCE || best - runnerUp < AMBIGUOUS_GAP;
  return { kind, confidence: Math.max(0, Math.min(1, best)), scores, ambiguous };
}

const TITLE_WORDS =
  /\b(engineer|analyst|manager|scientist|associate|designer|developer|specialist|intern|consultant|lead|director|architect|strategist|coordinator|researcher|administrator|representative|product|accelerator)\b/i;

/** Used when no title can be found. Templates read "the open role". */
export const ROLE_UNKNOWN = "open";

/** A line that reads like prose (not a job title). */
function isSentence(l: string): boolean {
  return l.split(/\s+/).length > 8 || /[.!?]$/.test(l) || /^(this|we|you|our|the|as|in|at|join)\b/i.test(l);
}

export function extractJobMeta(text: string): JobMeta {
  const ls = lines(text);
  let role = "";
  for (const l of ls.slice(0, 30)) {
    const clean = l.replace(/^(job title|title|role|position)\s*:\s*/i, "");
    if (clean.length <= 80 && TITLE_WORDS.test(clean) && !isSentence(clean)) {
      role = clean;
      break;
    }
  }
  if (!role) {
    // "the Policy Analyst position", "for the Data Analyst role"
    const m = text.match(/\bthe[ \t]+((?:[A-Z][\w&/-]*[ \t]+){0,4}[A-Z][\w&/-]*)[ \t]+(?:position|role|opening)\b/);
    if (m && TITLE_WORDS.test(m[1])) role = m[1];
  }
  if (!role) role = ls[0] && !isSentence(ls[0]) && ls[0].length <= 80 ? ls[0] : ROLE_UNKNOWN;

  let company: string | null = null;
  const m =
    text.match(/\b[Aa]bout[ \t]+([A-Z][\w&.-]*(?:[ \t]+[A-Z][\w&.-]*){0,3})/) ??
    text.match(/\bat[ \t]+([A-Z][\w&.-]*(?:[ \t]+[A-Z][\w&.-]*){0,2}),/) ??
    text.match(/^([A-Z][\w&.-]*(?:[ \t]+[A-Z][\w&.-]*){0,2})[ \t]+is[ \t]+(a|an|the)\b/m);
  if (m && !/^(the|this|us|you|our|the role|the team)$/i.test(m[1]) && /^[A-Z]/.test(m[1])) company = m[1].trim();

  return { role, company, seniority: inferSeniority(text), companyType: inferCompanyType(text) };
}

export function inferSeniority(text: string): Seniority {
  const t = text.toLowerCase();
  if (/\b(intern|internship|co-?op)\b/.test(t)) return "intern";
  if (/\b(senior|staff|principal|sr\.)\b|\b([5-9]|1\d)\+?\s*(years|yrs)/.test(t)) return "senior";
  if (/\b(new grad|entry[- ]level|junior|early career|0\s*[-–]\s*2\s*years|graduate program|accelerator)\b/.test(t))
    return "entry";
  if (/\b[2-4]\+?\s*(years|yrs)|\bmid[- ]level\b/.test(t)) return "mid";
  return "unknown";
}

export function inferCompanyType(text: string): CompanyType {
  const t = text.toLowerCase();
  if (/\b(non-?profit|501\(c\)|mission-driven nonprofit)\b/.test(t)) return "nonprofit";
  if (/\b(seed|series a|series b|y combinator|yc [sw]\d|early[- ]stage|founding|startup)\b/.test(t)) return "startup";
  if (/\b(series [c-f]|pre-ipo|scale-?up|hypergrowth)\b/.test(t)) return "growth";
  if (/\b(fortune 500|global leader|\d{2},\d{3}\+? employees|publicly traded|nyse|nasdaq)\b/.test(t)) return "enterprise";
  if (/\b(agency|consultancy|clients across)\b/.test(t)) return "agency";
  return "unknown";
}

const REQ_HEADER =
  /^(requirements|qualifications|minimum qualifications|preferred qualifications|basic qualifications|what you'?ll (bring|need)|who you are|you have|you might be a fit|skills|must[- ]haves?|nice to haves?|bonus points|what we'?re looking for)\b/i;
const OTHER_HEADER = /^(benefits|perks|about (us|the company)|compensation|salary|equal opportunity|how to apply|location)\b/i;

/** Pull requirement lines, preferring bullets under requirement-style headers. */
export function extractRequirements(text: string, max = 12): { text: string; weight: number }[] {
  const ls = lines(text);
  const picked: { text: string; weight: number }[] = [];
  let inReq = false;
  let preferred = false;
  for (const l of ls) {
    const bare = l.replace(/[:#*]/g, "").trim();
    if (REQ_HEADER.test(bare) && bare.length < 60) {
      inReq = true;
      preferred = /preferred|nice|bonus/i.test(bare);
      continue;
    }
    if (OTHER_HEADER.test(bare) && bare.length < 60) {
      inReq = false;
      continue;
    }
    if (inReq && (isBullet(l) || (l.length > 25 && l.length < 260))) {
      picked.push({ text: stripBullet(l), weight: preferred || /\b(nice|bonus|plus|preferred)\b/i.test(l) ? 0.75 : /\b(must|required)\b/i.test(l) ? 1.5 : 1 });
    }
  }
  if (picked.length < 3) {
    for (const l of ls) {
      if (isBullet(l) && l.length > 20 && !picked.some((p) => p.text === stripBullet(l))) picked.push({ text: stripBullet(l), weight: 1 });
    }
  }
  return picked.slice(0, max).map((p) => ({ ...p, text: p.text.slice(0, 300) }));
}

const RECRUITER = /\b(recruit\w*|talent|sourc(er|ing)|acquisition)\b/i;
const HR = /\b(hr|human resources|people (ops|operations|partner)|hrbp|people team)\b/i;
const MANAGER = /\b(manager|head of|director|vp|vice president|founder|co-?founder|cto|ceo|chief|lead)\b/i;

/** Lines starting with these words, or ending in "Team", are never a person's name. */
const NOT_A_NAME = /^(the|our|thank|thanks|best|kind|warm|regards|sincerely|hi|hello|dear|cheers|team|talent|recruiting|hiring|human|people|about|experience|education|activity)\b|\bteam$/i;

export function extractRecipientMeta(text: string, hasSharedSchool: boolean): RecipientMeta {
  const ls = lines(text).filter((l) => !/^(contact info|message|connect|follow|more)$/i.test(l));
  const nameLine = ls.find((l) => /^[A-Z][a-zA-Z'-]+(\s+[A-Z][a-zA-Z.'-]+){0,3}$/.test(l) && !NOT_A_NAME.test(l)) ?? null;
  const firstName = nameLine ? nameLine.split(/\s+/)[0] : null;
  const title =
    ls.find((l) => l !== nameLine && (RECRUITER.test(l) || HR.test(l) || MANAGER.test(l) || /\s(at|@)\s|\s\|\s/.test(l)))?.slice(0, 160) ??
    null;
  const t = title ?? "";
  let recipientType: RecipientType = "team_member";
  let reason = title ? `Title: ${title}` : "No clear title found";
  if (RECRUITER.test(t)) recipientType = "recruiter";
  else if (HR.test(t)) recipientType = "hr";
  else if (hasSharedSchool) {
    recipientType = "alum";
    reason = "You went to the same school";
  } else if (MANAGER.test(t)) recipientType = "hiring_manager";
  return { firstName, title, recipientType, reason: reason.slice(0, 160) };
}

/** Recipient type from a job title alone (used for imported connections). */
export function recipientTypeFromTitle(title: string | null): RecipientType {
  const t = title ?? "";
  if (RECRUITER.test(t)) return "recruiter";
  if (HR.test(t)) return "hr";
  if (MANAGER.test(t)) return "hiring_manager";
  return "team_member";
}
