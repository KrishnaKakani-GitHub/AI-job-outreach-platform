"use client";
import { useState } from "react";
import { GAP_LABELS } from "@/lib/fit";
import { RECIPIENT_LABELS } from "@/lib/draft";
import { DOC_KINDS, type DocKind, type Evidence } from "@/lib/schemas";
import { kindLabel, loadSimilar, type FitPayload, type PastePayload, type SimilarPayload, type StrategyPayload } from "@/client/assistant";
import { db } from "@/client/db";
import { pct, ScoreRing } from "./charts";
import { IconCheck, IconDoc } from "./icons";
import { EvidenceBadge } from "./ui";
import { COMPANY_LABEL, labelFor, SENIORITY_LABEL } from "@/lib/labels";

const EVIDENCE_STYLE: Record<Evidence, { label: string; cls: string }> = {
  strong: { label: "Strong", cls: "bg-accent-soft text-ink" },
  partial: { label: "Partial", cls: "bg-warn-soft text-warn" },
  missing: { label: "Missing", cls: "bg-sunk text-ink-2" },
};

export function FitCard({ p }: { p: FitPayload }) {
  const { report } = p;
  const [stageSet, setStageSet] = useState(false);
  async function markApplied() {
    const a = await db.applications.get(p.applicationId);
    if (a && a.stage === "saved") await db.applications.update(a.id, { stage: "applied", history: [...a.history, { stage: "applied", at: Date.now() }] });
    setStageSet(true);
  }
  return (
    <article className="settle rounded-2xl border border-line bg-surface" aria-label="Fit check">
      <header className="flex items-center gap-4 px-4 py-4">
        <ScoreRing score={report.score} />
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-tight">{report.meta.role}</h3>
          <p className="text-[13.5px] text-ink-2">
            {[report.meta.company, SENIORITY_LABEL[report.meta.seniority], COMPANY_LABEL[report.meta.companyType]].filter(Boolean).join(", ")}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">Fit score from {report.ratings.length} requirements{report.source === "rules" ? ", matched by keyword" : ""}.</p>
        </div>
      </header>

      {report.gaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-[13px]">
          <span className="text-ink-3">Gaps to address</span>
          {report.gaps.map((g) => (
            <span key={g} className="rounded-full border border-line px-2.5 py-0.5">{GAP_LABELS[g]}</span>
          ))}
        </div>
      )}

      {p.checklist.length > 0 && (
        <details className="border-t border-line px-4 py-3" open>
          <summary className="cursor-pointer text-[14px] font-medium">Before you apply ({p.checklist.length})</summary>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            {p.checklist.map((c) => (
              <li key={c.tag} className="flex gap-2">
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" aria-label={c.question} />
                <span>
                  {c.question}
                  {c.occurrences > 1 && <span className="ml-1 text-[12px] text-ink-3">Came up in {c.occurrences} of your recent fit checks.</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="border-t border-line px-4 py-3">
        <summary className="cursor-pointer text-[14px] font-medium">Requirement breakdown</summary>
        <ul className="mt-2 divide-y divide-line">
          {report.ratings.map((r) => (
            <li key={r.requirement} className="grid grid-cols-[4.5rem_1fr] gap-3 py-2 text-[14px]">
              <span className={`h-fit rounded-md px-1.5 py-0.5 text-center text-[12px] ${EVIDENCE_STYLE[r.evidence].cls}`}>{EVIDENCE_STYLE[r.evidence].label}</span>
              <div>
                <p>{r.requirement}</p>
                {r.resumeQuote ? <p className="mt-0.5 font-serif text-[14px] text-ink-2">“{r.resumeQuote}”</p> : <p className="mt-0.5 text-[12.5px] text-ink-3">No resume line backs this up yet.</p>}
              </div>
            </li>
          ))}
        </ul>
      </details>

      <footer className="flex items-center gap-3 border-t border-line px-4 py-2.5 text-[13px]">
        <span className="text-ink-3">Paste someone&apos;s LinkedIn profile next to draft a note.</span>
        <button type="button" onClick={markApplied} disabled={stageSet} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 hover:bg-sunk disabled:opacity-60">
          {stageSet ? <IconCheck width={14} height={14} /> : null}
          {stageSet ? "Marked as applied" : "Mark as applied"}
        </button>
      </footer>
    </article>
  );
}

export function PasteBubble({ text, p, onReclassify, disabled }: { text: string; p: PastePayload; onReclassify: (k: DocKind) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = text.split("\n").find((l) => l.trim())?.slice(0, 80) ?? "";
  return (
    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-sunk px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <IconDoc width={18} height={18} className="shrink-0 text-ink-2" />
        <div className="min-w-0">
          <p className="truncate text-[14px]">{preview}</p>
          <p className="text-[12px] text-ink-3">
            {p.chars.toLocaleString()} characters ·{" "}
            <label>
              <span className="sr-only">Document type</span>
              <select
                className="rounded bg-transparent text-[12px] text-ink-2 underline decoration-dotted underline-offset-2 outline-none"
                value={p.docKind}
                disabled={disabled}
                onChange={(e) => onReclassify(e.target.value as DocKind)}
              >
                {DOC_KINDS.map((k) => (
                  <option key={k} value={k}>{`Looks like a ${kindLabel(k)}`}</option>
                ))}
              </select>
            </label>
          </p>
        </div>
        <button type="button" className="ml-2 text-[12px] text-ink-3 hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap border-t border-line pt-2 font-sans text-[13px] text-ink-2">{text}</pre>}
    </div>
  );
}

export function ProfileNotice({ what, onOpenProfile }: { what: "resume" | "background"; onOpenProfile: () => void }) {
  return (
    <div className="settle flex flex-wrap items-center gap-2 text-[14.5px]">
      <IconCheck width={16} height={16} className="text-accent" />
      <span>Saved your {what} to your profile. I&apos;ll use it for every fit check and draft from now on.</span>
      <button type="button" className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink" onClick={onOpenProfile}>
        Review profile
      </button>
    </div>
  );
}

export function StrategyCard({ p }: { p: StrategyPayload }) {
  const { facts, narrative } = p;
  return (
    <article className="settle rounded-2xl border border-line bg-surface" aria-label="Next steps">
      <header className="px-4 pb-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold">Your next moves</h3>
          {p.progress && <EvidenceBadge tier={p.progress.tier} />}
        </div>
        <p className="mt-1 max-w-[68ch] text-[14.5px] leading-relaxed">{narrative.summary}</p>
        <p className="mt-1 text-[12px] text-ink-3">
          Based on {facts.status.applied} applications{p.progress ? ` and ${p.progress.resolved} outcomes` : ""}. {p.progress?.next ?? ""} Reasons for rejections are likely patterns, not certainties.
        </p>
      </header>

      {facts.stalls.length > 0 && (
        <Section title="Where applications stall">
          <ul className="space-y-1 text-[14px]">
            {facts.stalls.map((s) => (
              <li key={s.label} className="flex justify-between gap-4"><span>{s.label}</span><span className="tabular-nums text-ink-2">{s.count}</span></li>
            ))}
          </ul>
        </Section>
      )}

      {facts.targets.length > 0 && (
        <Section title="Best next targets">
          <ul className="space-y-3">
            {facts.targets.map((t, i) => (
              <li key={`${t.family}-${t.seniority}`} className="text-[14px]">
                <p className="font-medium">
                  {t.family}, {labelFor(SENIORITY_LABEL, t.seniority)}
                  <span className="ml-2 text-[12.5px] font-normal text-ink-3">average fit {t.avgFit} · response {t.progress.enough ? pct(t.progress.rate) : `${t.progress.k}/${t.progress.n}`}</span>
                </p>
                <p className="text-ink-2">{narrative.targetWhy[i]}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {facts.apply.length > 0 && (
        <Section title="Apply next">
          <ol className="list-decimal space-y-1 pl-5 text-[14px]">
            {facts.apply.map((a) => (
              <li key={a.id}>
                {a.role}{a.company ? ` at ${a.company}` : ""} <span className="tabular-nums text-ink-3">fit {a.score}</span>
                {a.gaps.length > 0 && <span className="text-ink-3"> · shore up {a.gaps.map((g) => GAP_LABELS[g].toLowerCase()).join(" and ")}</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {facts.tweaks.length > 0 && (
        <Section title="Resume tweaks">
          <ul className="space-y-3 text-[14px]">
            {facts.tweaks.map((t) => (
              <li key={t.original}>
                <p className="text-ink-3">{t.issue}</p>
                <p className="mt-1 font-serif text-ink-2"><span className="mr-1.5 font-sans text-[12px] text-ink-3">Now</span>{t.original}</p>
                <p className="font-serif"><span className="mr-1.5 font-sans text-[12px] text-ink-3">Try</span>{t.scaffold}</p>
                <p className="text-[12.5px] text-warn">Needs your input: {t.needsInput.join(", ")}. I won&apos;t fill these in for you.</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {facts.language.length > 0 && (
        <Section title="Language to borrow">
          <ul className="space-y-1 text-[14px]">
            {facts.language.map((l) => (
              <li key={l.marketTerm}>
                <span className="font-medium">“{l.marketTerm}”</span>
                <span className="text-ink-2"> appears in {pct(l.jdShare)} of your saved posts{l.yourTerm ? `; your resume says “${l.yourTerm}”` : " and not in your resume"}.</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <h4 className="mb-2 text-[14px] font-medium">{title}</h4>
      {children}
    </section>
  );
}

export function SimilarCard({ messageId, p }: { messageId: string; p: SimilarPayload }) {
  const [loading, setLoading] = useState(false);
  return (
    <article className="settle rounded-2xl border border-line bg-surface px-4 py-4" aria-label="Similar companies">
      <h3 className="text-[16px] font-semibold">You reached the final round at {p.company}</h3>
      <p className="mt-1 max-w-[68ch] text-[14.5px] text-ink-2">
        That means your profile fits this kind of {p.role} role. Companies close to {p.company} are worth a look while that fit is fresh.
      </p>
      {p.companies ? (
        <ul className="mt-3 divide-y divide-line">
          {p.companies.map((c) => (
            <li key={c.name} className="py-2 text-[14px]">
              <p className="font-medium">{c.name}</p>
              <p className="text-ink-2">{c.why}</p>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            await loadSimilar(messageId, p);
            setLoading(false);
          }}
          className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-60"
        >
          {loading ? "Finding similar companies…" : "Show similar companies"}
        </button>
      )}
      {p.error && <p className="mt-2 text-[13px] text-danger">{p.error}</p>}
      {p.companies && <p className="mt-2 text-[12px] text-ink-3">AI suggestions. Check each company&apos;s careers page to confirm they are hiring for this role.</p>}
    </article>
  );
}

export { RECIPIENT_LABELS };
