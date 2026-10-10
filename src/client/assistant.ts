"use client";
/**
 * The chat orchestrator. Every user message is routed deterministically:
 * pasted documents are classified by rules and sent to the matching typed
 * tool; short messages are checked for known intents (shorter, follow-up,
 * email, next steps) before falling back to a free-form streamed reply.
 */
import { classifyDocument, extractRecipientMeta } from "@/lib/classify";
import { openerOf, renderDraft, templateDraft, STAGE_PARTS } from "@/lib/draft";
import { newApplication, newContact } from "@/lib/records";
import { detectSharedGround } from "@/lib/shared";
import { buildChecklist } from "@/lib/fit";
import { finalRoundRejections, type StrategyFacts } from "@/lib/strategy";
import type { AnatomyPart, Application, Channel, Contact, DocKind, FitReport, MessageFeatures, RecipientType, Stage, SimilarCompany } from "@/lib/schemas";
import type { DraftResult, InterviewResult, TailorResult } from "@/server/services";
import { traceRules } from "@/lib/skills/catalog";
import type { ContextManifest, SkillContext } from "@/lib/skills/context";
import { uid } from "@/lib/text";
import { buildChatRequest } from "@/lib/chat";
import { findResumeInHistory, nextResumeVersion } from "@/lib/ingest";
import { addMessage, db, getProfile, saveProfile, updatePayload, type ChatMessage } from "./db";
import { myVariant, prefs, track } from "./session";
import { buildCraft, contextFor, freezeCv, guidanceFor, leadBoosts, refreshSkills, resumeFor, signedRules } from "./learning";
import { familyOf } from "@/lib/insights";
import { followedRefs } from "@/lib/memory";
import { RULE_BY_ID } from "@/lib/skills/catalog";
import { relearn, remember } from "./memory";
import { tierProgress, type Craft, type DraftGuidance, type TierProgress } from "@/lib/learn";

/** Demo mode keeps synthetic records separate from real ones. */
export function isDemo(): boolean {
  return prefs.get("wi-demo") === "1";
}

function messageFeatures(result: DraftResult, stage: Stage, channel: Channel, variant: "A" | "B"): MessageFeatures {
  const text = renderDraft(result.draft);
  const first = result.draft.segments[0];
  const lead = result.draft.segments.find((s) => s.part === "background")?.claims.find((c) => c.source === "me")?.quote ?? null;
  return {
    stage,
    channel,
    opener: openerOf(result.draft, result.shared, variant),
    chars: text.length,
    editRatio: null,
    copiedAt: null,
    ruleTrace: variant === "A" ? [] : traceRules("message", { message: { text, channel, stage, hasClaim: Boolean(first?.claims.length) } }),
    leadQuote: lead,
  };
}

export interface FitPayload {
  applicationId: string;
  report: FitReport;
  checklist: ReturnType<typeof buildChecklist>;
}

export interface DraftPayload {
  contactId: string;
  applicationId: string | null;
  variant: "A" | "B";
  recipientText: string;
  stage: Stage;
  channel: Channel;
  recipientType: RecipientType | null;
  result: DraftResult;
  editedText: string | null;
  shownAt: number;
  copiedAt: number | null;
  error: string | null;
  guidance?: DraftGuidance | null;
}

export interface CraftPayload {
  applicationId: string;
  craft: Craft;
  /** What the card was built from (no AI involved). */
  context?: SkillContext | null;
}

export interface TailorPayload {
  applicationId: string;
  result: TailorResult | null;
  /** Same job, baseline skills only, for comparison. Loaded on demand. */
  baseline: TailorResult | null;
  skills: SkillContext | null;
  savedAt: number | null;
  error: string | null;
}

export interface InterviewPayload {
  applicationId: string;
  result: InterviewResult | null;
  error: string | null;
}

export interface StrategyPayload {
  progress?: TierProgress;
  facts: StrategyFacts;
  narrative: { summary: string; targetWhy: string[]; source: "ai" | "rules" };
}

export interface SimilarPayload {
  applicationId: string;
  company: string;
  role: string;
  companies: SimilarCompany[] | null;
  error: string | null;
}

export interface PastePayload {
  docKind: DocKind;
  chars: number;
}

export type Status = { label: string } | null;

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const KIND_LABEL: Record<DocKind, string> = {
  resume: "resume",
  background: "background",
  job_description: "job description",
  recipient_profile: "LinkedIn profile",
  message: "message",
  other: "text",
};
export function kindLabel(k: DocKind): string {
  return KIND_LABEL[k];
}

export function isPaste(text: string): boolean {
  return text.length > 280 || text.split("\n").length > 5;
}

interface Ctx {
  chatId: string;
  setStatus: (s: Status) => void;
  signal: AbortSignal;
}

/** Entry point for everything typed or pasted into the composer. */
export async function handleInput(text: string, ctx: Ctx, override?: DocKind): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (override || isPaste(trimmed)) {
    // When the rules can't tell (a tie or a weak score), ask instead of guessing:
    // a wrong guess can overwrite the saved resume or draft to the wrong person.
    const c = override ? null : classifyDocument(trimmed);
    const kind = override ?? (c!.ambiguous ? "other" : c!.kind);
    await addMessage({ id: uid(), chatId: ctx.chatId, role: "user", kind: "paste", text: trimmed, payload: { docKind: kind, chars: trimmed.length } satisfies PastePayload });
    await routeDocument(kind, trimmed, ctx);
    return;
  }
  await addMessage({ id: uid(), chatId: ctx.chatId, role: "user", kind: "text", text: trimmed });
  await routeIntent(trimmed, ctx);
}

/** Re-run routing when the user corrects the detected document type. */
export async function reclassify(messageId: string, kind: DocKind, ctx: Ctx): Promise<void> {
  const m = await db.messages.get(messageId);
  if (!m?.text) return;
  await db.messages.update(messageId, { payload: { docKind: kind, chars: m.text.length } satisfies PastePayload });
  await routeDocument(kind, m.text, ctx);
}

async function say(ctx: Ctx, text: string): Promise<void> {
  await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "text", text });
}

/** Say a nudge at most once per chat, so the app never asks for the same thing over and over. */
async function sayOnce(ctx: Ctx, text: string): Promise<void> {
  const already = await db.messages.where("chatId").equals(ctx.chatId).filter((m) => m.role === "assistant" && m.text === text).count();
  if (!already) await say(ctx, text);
}

/** Save a resume: version it when it changes (for A/B by resume version) and keep the name. */
async function saveResume(text: string, source: "paste" | "recovered"): Promise<void> {
  const prev = await getProfile();
  const resumeVersion = nextResumeVersion(prev.resumeVersion, prev.resume, text);
  await saveProfile({ resume: text, resumeVersion, name: prev.name || guessName(text) });
  console.info(JSON.stringify({ level: "info", event: "resume.saved", source, chars: text.length, resumeVersion, changed: resumeVersion !== prev.resumeVersion }));
}

async function routeDocument(kind: DocKind, text: string, ctx: Ctx): Promise<void> {
  switch (kind) {
    // Every document is saved, then analysed right away with whatever else is on file.
    case "resume":
      await saveResume(text, "paste");
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "profile", payload: { what: "resume" } });
      return streamChat(text, ctx);
    case "background":
      await saveProfile({ background: text.slice(0, 2000) });
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "profile", payload: { what: "background" } });
      return streamChat(text, ctx);
    case "job_description":
      return runFit(text, ctx);
    case "recipient_profile":
      return runDraft({ recipientText: text }, ctx);
    case "message":
      // Emails (often rejections): answer in chat, with the saved resume in context.
      return streamChat(text, ctx);
    default:
      // Unlabelled: still analyse it now (the chat sees the full text). The label chip lets the user file it.
      await sayOnce(ctx, "I wasn't sure what kind of document this is, so I'll read it as-is. Tap the label on your message to file it as a resume, job post, LinkedIn profile, or email.");
      return streamChat(text, ctx);
  }
}

function guessName(resume: string): string {
  const first = resume.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return /^[A-Z][a-z]+(\s[A-Z][a-z.'-]+){1,2}$/.test(first) ? first : "";
}

async function chatApplication(chatId: string): Promise<Application | null> {
  const chat = await db.chats.get(chatId);
  return chat?.applicationId ? ((await db.applications.get(chat.applicationId)) ?? null) : null;
}

async function runFit(jobText: string, ctx: Ctx): Promise<void> {
  const profile = await getProfile();
  ctx.setStatus({ label: "Reading the job post…" });
  try {
    const report = await post<FitReport>("/api/ai/analyze", { jobText, resume: profile.resume, background: profile.background }, ctx.signal);
    const now = Date.now();
    const app: Application = newApplication({
      id: uid(),
      createdAt: now,
      role: report.meta.role,
      company: report.meta.company,
      seniority: report.meta.seniority,
      companyType: report.meta.companyType,
      stage: "saved",
      history: [{ stage: "saved", at: now }],
      jobText,
      resumeVersion: profile.resumeVersion,
      fit: report,
      demo: isDemo(),
    });
    await db.applications.put(app);
    await db.chats.update(ctx.chatId, { applicationId: app.id, title: report.meta.company ? `${report.meta.role} · ${report.meta.company}` : report.meta.role });
    const history = await db.applications.filter((a) => a.demo === app.demo && a.id !== app.id).sortBy("createdAt");
    await addMessage({
      id: uid(),
      chatId: ctx.chatId,
      role: "assistant",
      kind: "fit",
      payload: { applicationId: app.id, report, checklist: buildChecklist(history, report) } satisfies FitPayload,
    });
    try {
      const craft = await buildCraft(app, isDemo());
      const context = await contextFor("craft", app, isDemo()).catch(() => null);
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "craft", payload: { applicationId: app.id, craft, context } satisfies CraftPayload });
    } catch (e) {
      // The fit card already rendered; suggestions are additive.
      console.warn(JSON.stringify({ level: "warn", event: "craft.failed", message: e instanceof Error ? e.message : String(e) }));
    }
    if (!profile.resume && !profile.background) {
      await sayOnce(ctx, "This check is based on the job post alone. Paste your resume once and every check after this compares against it automatically.");
    }
  } finally {
    ctx.setStatus(null);
  }
}

export interface DraftRequest {
  recipientText: string;
  stage?: Stage;
  channel?: Channel;
  recipientType?: RecipientType | null;
  instruction?: string | null;
  regeneratePart?: AnatomyPart | null;
  replaceMessageId?: string;
}

/** Create (or revise) a draft card. Variant A gets the template; B gets the AI draft. */
export async function runDraft(req: DraftRequest, ctx: Ctx): Promise<void> {
  const profile = await getProfile();
  const app = await chatApplication(ctx.chatId);
  const variant = myVariant();
  const prev = req.replaceMessageId ? ((await db.messages.get(req.replaceMessageId))?.payload as DraftPayload | undefined) : undefined;
  const stage = req.stage ?? prev?.stage ?? "invite_note";
  const channel = req.channel ?? prev?.channel ?? "linkedin";
  const recipientType = req.recipientType !== undefined ? req.recipientType : (prev?.recipientType ?? null);

  ctx.setStatus({ label: "Checking shared ground…" });
  try {
    let result: DraftResult;
    let guidance: DraftGuidance | null = null;
    const me = `${profile.background}\n${profile.resume}`.trim();
    if (variant === "A") {
      const shared = detectSharedGround(me, req.recipientText);
      const rMeta = extractRecipientMeta(req.recipientText, shared.some((s) => s.kind === "school"));
      const rt = recipientType ?? rMeta.recipientType;
      const draft = templateDraft({
        stage,
        channel,
        recipientType: rt,
        recipientFirstName: rMeta.firstName,
        myName: profile.name,
        role: app?.role ?? "[Role]",
        company: app?.company ?? null,
        shared,
        fit: app?.fit ?? null,
        premium: profile.linkedinPremium,
      });
      result = {
        draft,
        shared,
        recipient: { ...rMeta, recipientType: rt, suggested: recipientType === null },
        meta: { role: app?.role ?? "[Role]", company: app?.company ?? null },
        limit: channel === "linkedin" && stage === "invite_note" ? (profile.linkedinPremium ? 300 : 200) : null,
        issues: [],
        source: "rules",
        context: null,
      };
    } else {
      ctx.setStatus({ label: "Drafting…" });
      guidance = await guidanceFor(isDemo(), detectSharedGround(me, req.recipientText).map((s) => s.kind)).catch(() => null);
      const skills = await contextFor("draft", app, isDemo()).catch(() => null);
      result = await post<DraftResult>(
        "/api/ai/draft",
        {
          recipientText: req.recipientText,
          jobText: app?.jobText ?? "",
          background: profile.background,
          resume: profile.resume,
          myName: profile.name,
          stage,
          channel,
          recipientType,
          premium: profile.linkedinPremium,
          fit: app?.fit ?? null,
          instruction: req.instruction ?? null,
          regeneratePart: req.regeneratePart ?? null,
          current: prev?.result.draft ?? null,
          guidance: guidance ? { opener: guidance.opener, maxChars: guidance.maxChars, rules: guidance.rules } : null,
          skills,
        },
        ctx.signal,
      );
    }

    if (variant === "B") {
      await remember({
        demo: isDemo(),
        kind: "message_drafted",
        applicationId: app?.id ?? null,
        family: app ? familyOf(app) : null,
        title: `${result.source === "ai" ? "AI" : "Rules"} draft to ${result.recipient.firstName ?? "a contact"} (${result.recipient.recipientType}, ${stage}, ${channel})`,
        detail: renderDraft(result.draft, { includeSubject: true }),
        refs: [...(result.context?.learned.map((r) => r.id) ?? []), ...messageFeatures(result, stage, channel, variant).ruleTrace],
      });
    }

    if (prev && req.replaceMessageId) {
      await updatePayload(req.replaceMessageId, { result, stage, channel, recipientType, editedText: null, shownAt: Date.now(), error: null, guidance });
      await db.contacts.update(prev.contactId, { stage: "drafted", channel, recipientType: result.recipient.recipientType, message: messageFeatures(result, stage, channel, variant) });
    } else {
      const now = Date.now();
      const contact: Contact = newContact({
        id: uid(),
        applicationId: app?.id ?? null,
        createdAt: now,
        firstName: result.recipient.firstName,
        title: result.recipient.title,
        company: app?.company ?? null,
        recipientType: result.recipient.recipientType,
        stage: "drafted",
        history: [{ stage: "drafted", at: now }],
        variant,
        channel,
        demo: isDemo(),
        source: "chat",
        message: messageFeatures(result, stage, channel, variant),
      });
      await db.contacts.put(contact);
      await addMessage({
        id: uid(),
        chatId: ctx.chatId,
        role: "assistant",
        kind: "draft",
        payload: {
          contactId: contact.id,
          applicationId: app?.id ?? null,
          variant,
          recipientText: req.recipientText,
          stage,
          channel,
          recipientType,
          result,
          editedText: null,
          shownAt: now,
          copiedAt: null,
          error: null,
          guidance,
        } satisfies DraftPayload,
      });
      if (!app) await sayOnce(ctx, "Tip: paste the job description in this chat too. Then the draft can say why you fit, using your strongest matching resume line.");
    }
    void track("exposure");
    void track("draft_generated");
  } finally {
    ctx.setStatus(null);
  }
}

/** Find the most recent draft card in this chat (for "make it shorter" and friends). */
async function latestDraft(chatId: string): Promise<ChatMessage | undefined> {
  const msgs = await db.messages.where("chatId").equals(chatId).sortBy("createdAt");
  return [...msgs].reverse().find((m) => m.kind === "draft");
}

async function routeIntent(text: string, ctx: Ctx): Promise<void> {
  const t = text.toLowerCase();
  const draftMsg = await latestDraft(ctx.chatId);
  const draft = draftMsg?.payload as DraftPayload | undefined;

  if (/\b(what should i do next|next steps?|strategy|where should i (apply|aim)|debrief)\b/.test(t)) return runStrategy(ctx);
  if (/\b(tailor|customi[sz]e)\b.*\b(resume|cv)\b|\b(resume|cv)\b.*\b(for this|tailor)/.test(t)) return runTailor(ctx);
  if (/\binterview\b.*\b(prep|questions|practice)|\bprep\b.*\binterview\b/.test(t)) return runInterview(ctx);

  if (draft && draftMsg) {
    const redo = (r: Omit<DraftRequest, "recipientText" | "replaceMessageId">) => runDraft({ ...r, recipientText: draft.recipientText, replaceMessageId: draftMsg.id }, ctx);
    if (/\b(accepted|follow[- ]?up)\b/.test(t)) return redo({ stage: "accepted_followup" });
    if (/\breferral\b/.test(t)) return redo({ stage: "referral_ask" });
    if (/\b(invite|connection note)\b/.test(t)) return redo({ stage: "invite_note" });
    if (/\b(email|e-mail)\b/.test(t)) return redo({ channel: "email" });
    if (/\blinkedin\b/.test(t)) return redo({ channel: "linkedin" });
    if (/\b(shorter|shorten|more concise|longer|warmer|more formal|less formal|friendlier|rewrite|redo)\b/.test(t)) {
      if (draft.variant === "A") {
        await say(ctx, "This draft is the fill-in-the-blanks version, so edit it directly in the card.");
        return;
      }
      return redo({ instruction: text });
    }
  }
  return streamChat(text, ctx);
}

export async function runStrategy(ctx: Ctx): Promise<void> {
  const demo = isDemo();
  const apps = await db.applications.filter((a) => a.demo === demo).toArray();
  const profile = await getProfile();
  if (!apps.length) {
    await say(ctx, "There's nothing to learn from yet. Paste a job post to start, or turn on demo data in the sidebar to see what this looks like with a search history.");
    return;
  }
  ctx.setStatus({ label: "Reading your search history…" });
  try {
    const out = await post<StrategyPayload>("/api/ai/strategy", { applications: apps, resume: demo ? (await import("@/lib/demo")).DEMO_RESUME : profile.resume }, ctx.signal);
    await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "strategy", payload: { ...out, progress: tierProgress(apps, Date.now()) } satisfies StrategyPayload });
  } finally {
    ctx.setStatus(null);
  }
}

/** Called by the tracker when an application moves from final round to rejected. */
export async function offerSimilarCompanies(app: Application, chatId: string): Promise<void> {
  if (!finalRoundRejections([app]).length || !app.company) return;
  await addMessage({
    id: uid(),
    chatId,
    role: "assistant",
    kind: "similar",
    payload: { applicationId: app.id, company: app.company, role: app.role, companies: null, error: null } satisfies SimilarPayload,
  });
}

export async function loadSimilar(messageId: string, p: SimilarPayload): Promise<void> {
  try {
    const app = await db.applications.get(p.applicationId);
    const out = await post<{ companies: SimilarCompany[] }>("/api/ai/similar", { company: p.company, role: p.role, jobText: app?.jobText ?? "" });
    await updatePayload(messageId, { companies: out.companies, error: null });
  } catch (e) {
    await updatePayload(messageId, { error: e instanceof Error ? e.message : "Could not load suggestions." });
  }
}

async function streamChat(text: string, ctx: Ctx): Promise<void> {
  const stored = await db.messages.where("chatId").equals(ctx.chatId).sortBy("createdAt");
  const app = await chatApplication(ctx.chatId);
  let profile = await getProfile();
  if (!profile.resume.trim()) {
    // The user may have pasted it under the wrong label: recover it instead of asking again.
    const found = findResumeInHistory(stored);
    if (found) {
      await saveResume(found, "recovered");
      profile = await getProfile();
    }
  }
  const { messages: history, context } = buildChatRequest({
    messages: stored,
    text,
    profile: { resume: profile.resume, background: profile.background },
    app: app ? { role: app.role, company: app.company, fit: app.fit ? { score: app.fit.score, gaps: app.fit.gaps } : null, jobText: app.jobText } : null,
  });
  console.info(JSON.stringify({ level: "info", event: "chat.request", turns: history.length, hasResume: Boolean(profile.resume.trim()), contextChars: context.length }));
  const id = uid();
  await addMessage({ id, chatId: ctx.chatId, role: "assistant", kind: "text", text: "" });
  ctx.setStatus({ label: "Thinking…" });
  try {
    const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, context }), signal: ctx.signal });
    if (!res.ok || !res.body) throw new Error("The assistant is unavailable right now.");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = "";
    ctx.setStatus(null);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      await db.messages.update(id, { text: acc });
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      const m = await db.messages.get(id);
      if (!m?.text) await db.messages.update(id, { text: "_Stopped._" });
    } else {
      await db.messages.update(id, { text: e instanceof Error ? e.message : "Something went wrong." });
    }
  } finally {
    ctx.setStatus(null);
  }
}

export const PARTS_FOR = STAGE_PARTS;

// ---- Tailored CV ----

async function postTailor(app: Application, demo: boolean, skills: SkillContext | null, baselineOnly: boolean, signal?: AbortSignal): Promise<TailorResult> {
  const resume = await resumeFor(demo);
  return post<TailorResult>(
    "/api/ai/tailor",
    {
      resume,
      jobText: app.jobText,
      fit: app.fit,
      role: app.role,
      company: app.company,
      skills: baselineOnly ? null : skills,
      baselineOnly,
      boosts: baselineOnly ? [] : await leadBoosts(demo, familyOf(app)),
    },
    signal,
  );
}

/** Tailor the resume for this chat's application, using the personal skills. */
export async function runTailor(ctx: Ctx, applicationId?: string): Promise<void> {
  const app = applicationId ? await db.applications.get(applicationId) : await chatApplication(ctx.chatId);
  if (!app) {
    await say(ctx, "Paste the job post first, then ask me to tailor your resume for it.");
    return;
  }
  const demo = isDemo();
  if ((await resumeFor(demo)).length < 80) {
    await say(ctx, "Add your resume first (paste it here or open Profile). Tailoring only rearranges and rewords what's already in it.");
    return;
  }
  ctx.setStatus({ label: "Tailoring your resume…" });
  try {
    await refreshSkills(demo).catch(() => null);
    const skills = await contextFor("tailor", app, demo);
    const result = await postTailor(app, demo, skills, false, ctx.signal);
    await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "tailor", payload: { applicationId: app.id, result, baseline: null, skills, savedAt: null, error: null } satisfies TailorPayload });
  } finally {
    ctx.setStatus(null);
  }
}

/** Load the baseline-only version of the same tailoring, for the comparison view. */
export async function loadBaselineTailor(messageId: string, p: TailorPayload): Promise<void> {
  try {
    const app = await db.applications.get(p.applicationId);
    if (!app) throw new Error("The application is gone.");
    const baseline = await postTailor(app, isDemo(), null, true);
    await updatePayload(messageId, { baseline, error: null });
  } catch (e) {
    await updatePayload(messageId, { error: e instanceof Error ? e.message : "Couldn't load the baseline version." });
  }
}

/** Keep the tailored version: freeze it on the application with the rules it followed. */
export async function keepTailored(messageId: string, p: TailorPayload): Promise<void> {
  const app = await db.applications.get(p.applicationId);
  if (!app || !p.result) return;
  const profile = await getProfile();
  const rules = signedRules(p.result.applied.filter((id) => id.startsWith("learned/")), p.skills, p.result.context);
  const frozen = freezeCv(app, p.result.text, profile.resumeVersion, { text: p.result.text, rules }, Date.now());
  await db.applications.update(app.id, frozen);
  await remember({
    demo: app.demo,
    kind: "cv_kept",
    applicationId: app.id,
    family: familyOf(app),
    title: `Kept a tailored resume for ${app.role}${app.company ? ` at ${app.company}` : ""}`,
    detail: p.result.text,
    refs: [...followedRefs(rules), ...followedRefs(frozen.trace)],
  });
  await updatePayload(messageId, { savedAt: Date.now() });
}

/** Freeze the resume as sent when an application moves to "applied" (unless a tailored one is kept). */
export async function freezeOnApply(app: Application): Promise<Pick<Application, "cv" | "trace">> {
  const demo = app.demo;
  const profile = await getProfile();
  return freezeCv(app, await resumeFor(demo), demo ? "v1" : profile.resumeVersion, null, Date.now());
}

// ---- Interview prep ----

export async function runInterview(ctx: Ctx, applicationId?: string): Promise<void> {
  const app = applicationId ? await db.applications.get(applicationId) : await chatApplication(ctx.chatId);
  if (!app) {
    await say(ctx, "Paste the job post first, then ask for interview prep.");
    return;
  }
  ctx.setStatus({ label: "Preparing interview questions…" });
  try {
    await createInterviewCard(app, ctx.chatId, ctx.signal);
  } finally {
    ctx.setStatus(null);
  }
}

/** Also called by the tracker when an application reaches the interview stage. */
export async function createInterviewCard(app: Application, chatId: string, signal?: AbortSignal): Promise<void> {
  const demo = app.demo;
  const id = uid();
  await addMessage({ id, chatId, role: "assistant", kind: "interview", payload: { applicationId: app.id, result: null, error: null } satisfies InterviewPayload });
  try {
    const skills = await contextFor("interview", app, demo);
    const result = await post<InterviewResult>("/api/ai/interview", { resume: await resumeFor(demo), jobText: app.jobText, fit: app.fit, role: app.role, skills }, signal);
    await updatePayload(id, { result, error: null });
    await db.applications.update(app.id, { prepAt: Date.now() });
  } catch (e) {
    await updatePayload(id, { error: e instanceof Error ? e.message : "Couldn't prepare questions." });
  }
}

export type { ContextManifest };

/**
 * Side effects of a stage change, returned as a patch: freeze the resume when
 * the application is first applied for, and make an interview prep card the
 * first time it reaches the interview stage (in the open chat, if any).
 */
export async function afterStageChange(prev: Application, next: Application, chatId: string | null): Promise<Partial<Application>> {
  const patch: Partial<Application> = {};
  if (next.stage !== "saved" && prev.stage === "saved" && !next.trace) {
    Object.assign(patch, await freezeOnApply(next));
    const a = { ...next, ...patch };
    await remember({ demo: a.demo, kind: "applied", applicationId: a.id, family: familyOf(a), title: `Applied: ${a.role}${a.company ? ` at ${a.company}` : ""}${a.cv?.tailored ? " with a tailored resume" : ""}`, detail: insightLines(a), refs: [...followedRefs(a.trace), ...followedRefs(a.cv?.rules)] });
  }
  if (next.stage === "interview" && prev.stage !== "interview") {
    const a = { ...next, ...patch };
    await remember({ demo: a.demo, kind: "interview", applicationId: a.id, family: familyOf(a), title: `Interview: ${a.role}${a.company ? ` at ${a.company}` : ""}. What was on the resume you sent`, detail: insightLines(a), refs: [...followedRefs(a.trace), ...followedRefs(a.cv?.rules)] });
  }
  if (["interview", "final_round", "offer", "rejected", "withdrawn"].includes(next.stage) && next.stage !== prev.stage) void relearn(next.demo, `${next.role} moved to ${next.stage.replace("_", " ")}`);
  if (next.stage === "interview" && prev.stage !== "interview" && next.prepAt === null && chatId) {
    void createInterviewCard({ ...next, ...patch }, chatId).catch(() => null);
  }
  return patch;
}

/** The insights on the resume an application went out with, one per line, for the memory log. */
function insightLines(a: Application): string {
  const ids = [...followedRefs(a.cv?.rules), ...followedRefs(a.trace)];
  return ids.map((id) => (id.startsWith("learned/") ? `Your rule: ${id.slice(8)}` : RULE_BY_ID.get(id)?.text ?? id)).join("\n");
}
