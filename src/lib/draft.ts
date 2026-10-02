/**
 * Message construction: stage rules, the Variant A template, a rules-based
 * Variant B fallback (used when no AI key is configured), and rendering.
 */
import type { AnatomyPart, Channel, Claim, Draft, DraftSegment, FitReport, RecipientType, SharedGround, Stage } from "./schemas";

export const STAGE_LABELS: Record<Stage, string> = {
  invite_note: "Invite note",
  accepted_followup: "Accepted follow-up",
  referral_ask: "Referral ask",
};
export const RECIPIENT_LABELS: Record<RecipientType, string> = {
  alum: "Alum",
  recruiter: "Recruiter",
  hr: "HR",
  hiring_manager: "Hiring manager",
  team_member: "Team member",
};
export const CHANNEL_LABELS: Record<Channel, string> = {
  linkedin: "LinkedIn",
  email: "Email",
  platform_message: "Platform message",
};
export const PART_LABELS: Record<AnatomyPart, string> = {
  connection: "Connection",
  background: "Why I fit",
  learn: "What I'd like to learn",
  ask: "The ask",
};

/** Which anatomy parts each stage uses, in order. */
export const STAGE_PARTS: Record<Stage, AnatomyPart[]> = {
  invite_note: ["connection", "ask"],
  accepted_followup: ["connection", "background", "learn", "ask"],
  referral_ask: ["connection", "background", "ask"],
};

/** LinkedIn invite-note caps commonly reported for 2026 (not officially published). */
export function charLimit(stage: Stage, channel: Channel, premium: boolean): number | null {
  if (channel === "linkedin" && stage === "invite_note") return premium ? 300 : 200;
  return null;
}

export interface DraftContext {
  stage: Stage;
  channel: Channel;
  recipientType: RecipientType;
  recipientFirstName: string | null;
  myName: string;
  role: string;
  company: string | null;
  shared: SharedGround[];
  fit: FitReport | null;
  premium: boolean;
}

const ASKS: Record<Stage, Record<RecipientType, string>> = {
  invite_note: {
    alum: "Would love to connect.",
    recruiter: "Would love to connect.",
    hr: "Would love to connect.",
    hiring_manager: "Would love to connect.",
    team_member: "Would love to connect.",
  },
  accepted_followup: {
    alum: "If you have 10 to 15 minutes in the next few weeks, I would be grateful to hear about your path and any advice for someone in my position.",
    recruiter: "If you have 10 to 15 minutes, I would be grateful to learn what the team is prioritizing in candidates for this role.",
    hr: "If you have a few minutes, I would be grateful to know who on the team would be the right person to speak with about this role.",
    hiring_manager: "If you have 10 to 15 minutes, I would be grateful for the chance to learn what success looks like in this role in the first six months.",
    team_member: "If you have 10 to 15 minutes, I would be grateful to hear what the work is like day to day.",
  },
  referral_ask: {
    alum: "If you feel comfortable, would you be open to referring me? I am happy to send my resume and a short summary to make it easy.",
    recruiter: "Would you be open to flagging my application to the hiring team? I am happy to send anything that helps.",
    hr: "Would you be able to point me to the right person to request a referral? I am happy to send my resume.",
    hiring_manager: "Would you be open to considering my application or referring me internally? I am happy to share my resume.",
    team_member: "If you feel comfortable, would you be open to referring me? I am happy to send my resume and a short summary.",
  },
};

const LEARN: Record<RecipientType, string> = {
  alum: "I would love to hear how you made the move into your current role and what you wish you had known early on.",
  recruiter: "I would value your perspective on what the strongest candidates for this team tend to have in common.",
  hr: "I would value any guidance on how the team approaches early-career hiring.",
  hiring_manager: "I would love to understand the biggest problem the team is working on right now.",
  team_member: "I would love to understand what you enjoy most about the team and what the work looks like week to week.",
};

/** Variant A: the user's own four-part template with blanks to fill in. */
export function templateDraft(ctx: DraftContext): Draft {
  const name = ctx.recipientFirstName ?? "[First name]";
  const company = ctx.company ?? "[Company]";
  const segs: Record<AnatomyPart, string> = {
    connection:
      ctx.stage === "invite_note"
        ? `[Shared connection point]. I just applied for the ${ctx.role} role at ${company}.`
        : `Thanks for connecting! I recently applied for the ${ctx.role} role at ${company}, and noticed we both [shared connection point].`,
    background: "I recently graduated from [School] with a degree in [Major] and worked as [Role] at [Company], where I [1 to 2 sentences of relevant work].",
    learn: "I would love to learn more about your journey to [Company] and what your role looks like day to day.",
    ask: ASKS[ctx.stage][ctx.recipientType],
  };
  return {
    subject: ctx.channel === "email" ? `${ctx.role} application, quick question` : null,
    greeting: `Hi ${name},`,
    segments: STAGE_PARTS[ctx.stage].map((part) => ({ part, text: segs[part], claims: [] })),
    signoff: ctx.stage === "invite_note" ? `- ${ctx.myName.split(" ")[0] || "[Your name]"}` : `Best,\n${ctx.myName || "[Your name]"}`,
  };
}

/** Variant B fallback: a grounded draft built only from detected facts. */
export function rulesDraft(ctx: DraftContext): Draft {
  const company = ctx.company ?? "your team";
  const top = ctx.shared[0];
  const claims: Claim[] = [];
  let connection: string;
  if (top) {
    const phrase =
      top.kind === "school" ? `fellow ${top.label} grad here` : top.kind === "domain" ? `we both work in ${top.label}` : `we share a connection to ${top.label}`;
    connection = `${capitalize(phrase)}. I just applied for the ${ctx.role} role at ${company}.`;
    claims.push({ text: top.label, source: "recipient", quote: top.recipientQuote });
  } else {
    connection = `I just applied for the ${ctx.role} role at ${company}.`;
  }

  const strong = ctx.fit?.ratings.find((r) => r.evidence === "strong" && r.resumeQuote);
  let background = "";
  if (strong?.resumeQuote) {
    const q = strong.resumeQuote.replace(/^[-•*]\s*/, "").replace(/\.$/, "");
    const verbLed = /^(built|led|designed|developed|created|launched|shipped|ran|analyzed|implemented|reduced|increased|improved|partnered|owned|managed|wrote|automated|defined|delivered)\b/i.test(q);
    background = verbLed
      ? `The role asks for ${lowerFirst(strong.requirement.replace(/\.$/, ""))}, and in my own work I ${toFirstPerson(q)}.`
      : `The role asks for ${lowerFirst(strong.requirement.replace(/\.$/, ""))}, which my background covers (${q}).`;
    claims.push({ text: strong.requirement.replace(/\.$/, "").slice(0, 60), source: "job", quote: strong.requirement });
  } else {
    background = `I would bring hands-on experience that lines up with what the ${ctx.role} role describes.`;
  }

  const segs: Record<AnatomyPart, DraftSegment> = {
    connection: { part: "connection", text: connection, claims: claims.filter((c) => c.source === "recipient") },
    background: { part: "background", text: background, claims: claims.filter((c) => c.source === "job") },
    learn: { part: "learn", text: LEARN[ctx.recipientType], claims: [] },
    ask: { part: "ask", text: ASKS[ctx.stage][ctx.recipientType], claims: [] },
  };
  const draft: Draft = {
    subject: ctx.channel === "email" ? `${ctx.role} at ${company}${top ? `, ${top.label} connection` : ""}`.slice(0, 140) : null,
    greeting: `Hi ${ctx.recipientFirstName ?? "there"},`,
    segments: STAGE_PARTS[ctx.stage].map((p) => segs[p]),
    signoff: ctx.stage === "invite_note" ? `- ${ctx.myName.split(" ")[0] || "Me"}` : `Best,\n${ctx.myName || "Me"}`,
  };
  return fitToLimit(draft, charLimit(ctx.stage, ctx.channel, ctx.premium));
}

/** Shorten an over-limit draft deterministically: drop optional clauses, then trim. */
export function fitToLimit(draft: Draft, limit: number | null): Draft {
  if (!limit || renderDraft(draft).length <= limit) return draft;
  const d: Draft = { ...draft, segments: draft.segments.map((s) => ({ ...s })) };
  // 1) Remove the role sentence from the connection if needed.
  for (const s of d.segments) {
    if (renderDraft(d).length <= limit) break;
    const sentences = s.text.split(/(?<=\.)\s+/);
    if (sentences.length > 1) s.text = sentences[0];
  }
  // 2) Shorter sign-off.
  if (renderDraft(d).length > limit) d.signoff = d.signoff.split("\n").pop() ?? d.signoff;
  return d;
}

export function renderDraft(d: Draft, opts: { includeSubject?: boolean } = {}): string {
  const body = d.segments.map((s) => s.text).join(" ");
  const parts = [`${d.greeting} ${body}`, d.signoff];
  const text = d.signoff.includes("\n") ? `${d.greeting}\n\n${d.segments.map((s) => s.text).join("\n\n")}\n\n${d.signoff}` : parts.join(" ");
  return opts.includeSubject && d.subject ? `Subject: ${d.subject}\n\n${text}` : text;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
/** Resume bullets are written as verbs ("Built X"); lower-case the verb to fit "I built X". */
function toFirstPerson(bullet: string): string {
  return lowerFirst(bullet.replace(/^[-•*]\s*/, ""));
}
