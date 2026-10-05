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
import type { DraftResult } from "@/server/services";
import { uid } from "@/lib/text";
import { addMessage, db, getProfile, saveProfile, updatePayload, type ChatMessage } from "./db";
import { myVariant, prefs, track } from "./session";
import { buildCraft, guidanceFor } from "./learning";
import { tierProgress, type Craft, type DraftGuidance, type TierProgress } from "@/lib/learn";

/** Demo mode keeps synthetic records separate from real ones. */
export function isDemo(): boolean {
  return prefs.get("wi-demo") === "1";
}

function messageFeatures(result: DraftResult, stage: Stage, channel: Channel, variant: "A" | "B"): MessageFeatures {
  return { stage, channel, opener: openerOf(result.draft, result.shared, variant), chars: renderDraft(result.draft).length, editRatio: null, copiedAt: null };
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
    const kind = override ?? classifyDocument(trimmed).kind;
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

async function routeDocument(kind: DocKind, text: string, ctx: Ctx): Promise<void> {
  switch (kind) {
    case "resume":
      await saveProfile({ resume: text, name: (await getProfile()).name || guessName(text) });
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "profile", payload: { what: "resume" } });
      return;
    case "background":
      await saveProfile({ background: text });
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "profile", payload: { what: "background" } });
      return;
    case "job_description":
      return runFit(text, ctx);
    case "recipient_profile":
      return runDraft({ recipientText: text }, ctx);
    default:
      await say(ctx, "I couldn't tell what this is. Use the label on your message to mark it as a resume, job description, or LinkedIn profile, and I'll take it from there.");
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
      await addMessage({ id: uid(), chatId: ctx.chatId, role: "assistant", kind: "craft", payload: { applicationId: app.id, craft } satisfies CraftPayload });
    } catch (e) {
      // The fit card already rendered; suggestions are additive.
      console.warn(JSON.stringify({ level: "warn", event: "craft.failed", message: e instanceof Error ? e.message : String(e) }));
    }
    if (!profile.resume && !profile.background) {
      await say(ctx, "Paste your resume too and I'll score this against your actual experience. Until then the fit check has nothing to compare with.");
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
      };
    } else {
      ctx.setStatus({ label: "Drafting…" });
      guidance = await guidanceFor(isDemo(), detectSharedGround(me, req.recipientText).map((s) => s.kind)).catch(() => null);
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
        },
        ctx.signal,
      );
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
      if (!app) await say(ctx, "Tip: paste the job description in this chat too. Then the draft can say why you fit, using your strongest matching resume line.");
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
  const history = (await db.messages.where("chatId").equals(ctx.chatId).sortBy("createdAt"))
    .filter((m) => m.kind === "text" && m.text)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.text!.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") history.push({ role: "user", content: text });
  const app = await chatApplication(ctx.chatId);
  const context = app ? `Current application: ${app.role}${app.company ? ` at ${app.company}` : ""}. Fit score ${app.fit?.score ?? "n/a"}. Gaps: ${app.fit?.gaps.join(", ") || "none"}.` : "";
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
