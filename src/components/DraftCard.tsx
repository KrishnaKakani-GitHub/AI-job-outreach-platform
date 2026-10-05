"use client";
import { useMemo, useState } from "react";
import { CHANNEL_LABELS, PART_LABELS, RECIPIENT_LABELS, renderDraft, STAGE_LABELS } from "@/lib/draft";
import { editRatio } from "@/lib/ab";
import { CHANNELS, RECIPIENT_TYPES, STAGES, type AnatomyPart, type Channel, type Claim, type RecipientType, type Stage } from "@/lib/schemas";
import type { DraftPayload, DraftRequest } from "@/client/assistant";
import { db, updatePayload } from "@/client/db";
import { track } from "@/client/session";
import { IconAlert, IconCheck, IconCopy, IconRefresh } from "./icons";
import { Select } from "./ui";

interface Props {
  messageId: string;
  p: DraftPayload;
  busy: boolean;
  onRedraft: (req: Omit<DraftRequest, "recipientText" | "replaceMessageId">) => void;
}

export function DraftCard({ messageId, p, busy, onRedraft }: Props) {
  const { result } = p;
  const rendered = useMemo(() => renderDraft(result.draft, { includeSubject: p.channel === "email" }), [result.draft, p.channel]);
  const isTemplate = p.variant === "A";
  const [editing, setEditing] = useState(isTemplate);
  const [copied, setCopied] = useState(false);
  const text = p.editedText ?? rendered;
  const count = renderDraft(result.draft).length;
  const shownCount = p.editedText !== null ? p.editedText.replace(/^Subject:.*\n\n/, "").length : count;
  const over = result.limit !== null && shownCount > result.limit;
  const errors = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warn");
  const blanks = isTemplate && /\[[^\]]+\]/.test(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked: the text is still selectable in the card */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    const seconds = Math.round((Date.now() - p.shownAt) / 1000);
    void track("copied", seconds);
    void track("edited", Number(editRatio(rendered, text).toFixed(3)));
    await updatePayload(messageId, { copiedAt: Date.now() });
    const c = await db.contacts.get(p.contactId);
    if (c) {
      const now = Date.now();
      const message = c.message ? { ...c.message, copiedAt: now, editRatio: Number(editRatio(rendered, text).toFixed(3)) } : c.message;
      const sent = c.stage === "drafted" || c.stage === "not_contacted";
      await db.contacts.update(c.id, { message, ...(sent ? { stage: "sent" as const, history: [...c.history, { stage: "sent", at: now }] } : {}) });
    }
  }

  return (
    <article className="settle overflow-hidden rounded-2xl border border-line bg-surface" aria-label="Outreach draft">
      <div className="grid grid-cols-2 gap-2 border-b border-line px-3 py-3 sm:grid-cols-3 sm:gap-3 sm:px-4">
        <Select
          label="Recipient"
          value={result.recipient.recipientType}
          options={RECIPIENT_TYPES.map((v) => [v, RECIPIENT_LABELS[v]] as const)}
          badge={result.recipient.suggested ? <span className="hidden rounded bg-accent-soft px-1 text-[11px] text-ink-2 sm:inline" title={`Suggested · ${result.recipient.reason}`}>Suggested</span> : undefined}
          title={result.recipient.suggested ? `Suggested · ${result.recipient.reason}` : undefined}
          disabled={busy}
          onChange={(v) => onRedraft({ recipientType: v as RecipientType })}
        />
        <Select label="Stage" value={p.stage} options={STAGES.map((v) => [v, STAGE_LABELS[v]] as const)} disabled={busy} onChange={(v) => onRedraft({ stage: v as Stage })} />
        <Select label="Channel" value={p.channel} options={CHANNELS.map((v) => [v, CHANNEL_LABELS[v]] as const)} disabled={busy} onChange={(v) => onRedraft({ channel: v as Channel })} className="col-span-2 sm:col-span-1" />
      </div>

      {result.shared.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-[13px]">
          <span className="text-ink-3">Shared ground</span>
          {result.shared.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-ink" title={`You: “${s.meQuote}”\nThem: “${s.recipientQuote}”`}>
              <IconCheck width={13} height={13} />
              {s.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="px-4 pt-3 text-[13px] text-ink-3">No real shared ground found, so the note leads with the role.</p>
      )}

      {!isTemplate && p.guidance?.why && (
        <p className="px-4 pt-2 text-[12.5px] text-ink-3">
          <span className="font-medium text-ink-2">Learned from your outreach:</span> {p.guidance.why}
        </p>
      )}

      <div className="relative px-4 pb-2 pt-3">
        {result.draft.subject && !editing && (
          <p className="mb-2 font-serif text-[15px]">
            <span className="text-ink-3">Subject: </span>
            {result.draft.subject}
          </p>
        )}
        {editing ? (
          <label className="block">
            <span className="sr-only">Edit message</span>
            <textarea
              className="min-h-48 w-full resize-y rounded-lg border border-line bg-paper p-3 font-serif text-[16px] leading-7 outline-none focus:border-accent"
              value={text}
              onChange={(e) => void updatePayload(messageId, { editedText: e.target.value })}
            />
          </label>
        ) : (
          <div className="font-serif text-[16.5px] leading-[1.85] text-ink" style={{ maxWidth: "62ch" }}>
            <p className="mb-3">{result.draft.greeting}</p>
            {result.draft.segments.map((s, i) => (
              <p key={`${s.part}-${i}`} className="mb-3">
                <span className="mark" data-part={s.part} tabIndex={0} aria-label={`${PART_LABELS[s.part]}: ${s.text}`}>
                  <ClaimText text={s.text} claims={s.claims} />
                </span>
              </p>
            ))}
            <p className="whitespace-pre-line">{result.draft.signoff}</p>
          </div>
        )}
      </div>

      {(errors.length > 0 || warns.length > 0 || blanks) && (
        <ul className="mx-4 mb-3 space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          {blanks && <li>Fill in the bracketed parts before sending.</li>}
          {[...errors, ...warns].map((i) => (
            <li key={i.message} className="flex gap-1.5">
              <IconAlert width={14} height={14} className="mt-[3px] shrink-0" />
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2" aria-label="Message parts">
          {result.draft.segments.map((s) => (
            <li key={s.part}>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-sunk disabled:cursor-default disabled:hover:bg-transparent"
                disabled={isTemplate || busy}
                onClick={() => onRedraft({ regeneratePart: s.part as AnatomyPart })}
                title={isTemplate ? PART_LABELS[s.part] : `Rewrite only “${PART_LABELS[s.part]}”`}
              >
                <span className="swatch inline-block h-2.5 w-2.5 rounded-sm" data-part={s.part} />
                {PART_LABELS[s.part]}
              </button>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span className={`whitespace-nowrap text-[12px] tabular-nums ${over ? "font-semibold text-danger" : "text-ink-3"}`} aria-live="polite">
            {shownCount}
            {result.limit ? ` / ${result.limit}` : " characters"}
          </span>
          {!isTemplate && (
            <span className={`text-[12px] ${errors.length ? "text-danger" : "text-ink-3"}`} title={result.source === "ai" ? "Every personal detail was checked against your sources." : "Built from detected facts only."}>
              {errors.length ? "Needs a look" : "Grounded"}
            </span>
          )}
          {!isTemplate && (
            <button type="button" className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-sunk" onClick={() => setEditing((e) => !e)}>
              {editing ? "Done" : "Edit"}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onRedraft({})} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-sunk disabled:opacity-50">
            <IconRefresh width={15} height={15} /> Regenerate
          </button>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:opacity-90">
            {copied ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <p className="border-t border-line bg-paper px-4 py-1.5 text-[11.5px] text-ink-3">
        {isTemplate ? "You're in the template group of a live A/B test: this version uses your own four-part template." : "You're in the AI-draft group of a live A/B test."} Copying logs the message as sent in your tracker.
      </p>
    </article>
  );
}

/** Highlight each grounded claim; hovering or focusing shows the verbatim source line. */
function ClaimText({ text, claims }: { text: string; claims: Claim[] }) {
  if (!claims.length) return <>{text}</>;
  const pieces: (string | { c: Claim; t: string })[] = [];
  let rest = text;
  for (const c of claims) {
    const i = rest.toLowerCase().indexOf(c.text.toLowerCase());
    if (i < 0) continue;
    pieces.push(rest.slice(0, i), { c, t: rest.slice(i, i + c.text.length) });
    rest = rest.slice(i + c.text.length);
  }
  pieces.push(rest);
  const src = { recipient: "their profile", me: "your profile", job: "the job post" };
  return (
    <>
      {pieces.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="claim" title={`From ${src[p.c.source]}: “${p.c.quote}”`}>
            {p.t}
          </span>
        ),
      )}
    </>
  );
}
