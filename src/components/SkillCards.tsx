"use client";
/**
 * Cards for the skills layer: "What the AI saw", the tailored resume (with a
 * baseline comparison), and interview prep.
 */
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/client/db";
import { keepTailored, loadBaselineTailor, type InterviewPayload, type TailorPayload } from "@/client/assistant";
import { RULE_BY_ID, SKILLS, type SkillId } from "@/lib/skills/catalog";
import { TIER_TEXT, type ContextManifest } from "@/lib/skills/context";
import { FILL } from "@/lib/interview";
import type { TailorResult } from "@/server/services";
import { Button, EvidenceBadge } from "./ui";
import { IconCheck, IconCopy } from "./icons";

const ACTION_LABEL: Record<string, string> = {
  draft_message: "this draft",
  tailor_resume: "this resume",
  interview_prep: "these questions",
  craft: "this card",
};

/** Exactly what went into one output, built from the request that was sent. */
export function WhatTheAISaw({ m, computed = false }: { m: ContextManifest | null | undefined; computed?: boolean }) {
  if (!m) return null;
  return (
    <details className="group border-t border-line px-4 py-2 text-[13px]">
      <summary className="cursor-pointer select-none text-ink-2 hover:text-ink">
        {computed ? "What this card used" : "What the AI saw"}
        <span className="ml-2 text-[12px] text-ink-3">
          {m.baselineOnly ? "baseline skills only" : `${m.learned.length} learned rule${m.learned.length === 1 ? "" : "s"}, ${m.working.length + m.paused.length} scored`}
        </span>
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-[12px] text-ink-3">
          Built from the {computed ? "inputs this card was computed from" : "request sent to the model"} for {ACTION_LABEL[m.action] ?? m.action}, not written after the fact.
        </p>
        <Section title="Skills">
          <ul className="space-y-0.5">
            {m.skills.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-ink-3">{s.mode === "full" ? "full baseline skill" : "condensed baseline advice"}</span>
                <span className="text-ink-3">{s.version ? `+ your personal layer, version ${s.version}` : m.baselineOnly ? "" : "+ nothing learned yet"}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="House rules (override every skill)">
          <ul className="list-disc space-y-0.5 pl-4 text-ink-2">{m.house.map((h) => <li key={h}>{h}</li>)}</ul>
        </Section>
        {m.family && <Section title="Job type">{m.family}</Section>}
        {m.learned.length > 0 && (
          <Section title="Your learned rules">
            <ul className="space-y-1.5">
              {m.learned.map((r) => (
                <li key={r.id}>
                  <span className="mr-1.5 inline-block align-middle"><EvidenceBadge tier={r.tier} /></span>
                  {r.text} <span className="text-ink-3">({SKILLS[r.skill].name}. {r.evidence})</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {m.working.length > 0 && <Section title="Baseline advice your outcomes support"><RuleList items={m.working} /></Section>}
        {m.paused.length > 0 && <Section title="Baseline advice paused for you"><RuleList items={m.paused} /></Section>}
        {m.explore.length > 0 && (
          <Section title="Held back this time to keep testing">
            <p className="text-ink-2">{m.explore.length} learned rule{m.explore.length === 1 ? " was" : "s were"} left out on purpose, so the app keeps checking {m.explore.length === 1 ? "it" : "them"} against outcomes.</p>
          </Section>
        )}
        {m.profile.length > 0 && <Section title="Job-type facts from your outcomes"><ul className="list-disc space-y-0.5 pl-4 text-ink-2">{m.profile.map((f) => <li key={f}>{f}</li>)}</ul></Section>}
        {m.chains.length > 0 && <Section title="Outreach that worked"><ul className="list-disc space-y-0.5 pl-4 text-ink-2">{m.chains.map((f) => <li key={f}>{f}</li>)}</ul></Section>}
        {m.documents.length > 0 && (
          <Section title="Documents">
            <p className="text-ink-2">{m.documents.map((d) => `${d.label} (${d.chars.toLocaleString()} characters)`).join(", ")}</p>
          </Section>
        )}
      </div>
    </details>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{title}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function RuleList({ items }: { items: { id: string; text: string; evidence: string }[] }) {
  return (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.id}>
          {r.text} <span className="text-ink-3">({r.evidence})</span>
        </li>
      ))}
    </ul>
  );
}

function ruleLabel(id: string, m: ContextManifest | null): { skill: string; text: string } {
  const learned = m?.learned.find((r) => r.id === id);
  if (learned) return { skill: SKILLS[learned.skill].name, text: learned.text };
  const base = RULE_BY_ID.get(id);
  if (base) return { skill: SKILLS[base.skill].name, text: base.text };
  return { skill: id.split("/")[0], text: id };
}

function RuleChips({ ids, m }: { ids: string[]; m: ContextManifest | null }) {
  if (!ids.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => {
        const l = ruleLabel(id, m);
        const learned = id.startsWith("learned/");
        return (
          <span key={id} title={l.text} className={`rounded-full px-2 py-0.5 text-[11px] ${learned ? "bg-accent-soft text-ink" : "bg-sunk text-ink-2"}`}>
            {learned ? "Your rule · " : ""}
            {l.skill}
          </span>
        );
      })}
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink hover:opacity-90"
    >
      {done ? <IconCheck width={15} height={15} /> : <IconCopy width={15} height={15} />}
      {done ? "Copied" : label}
    </button>
  );
}

function Changes({ r }: { r: TailorResult }) {
  return (
    <ul className="divide-y divide-line">
      {r.changes.map((c, i) => (
        <li key={i} className="py-2">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{c.kind === "summary" ? "Summary" : c.kind === "moved" ? "Moved up" : "Reworded"}</p>
          {c.before && c.kind !== "moved" && <p className="text-[13px] text-ink-3 line-through decoration-ink-3/50">{c.before}</p>}
          <p className="text-[14px]">{c.after}</p>
          {c.why && <p className="text-[12.5px] text-ink-2">{c.why}</p>}
          <RuleChips ids={c.ruleIds} m={r.context} />
        </li>
      ))}
      {!r.changes.length && <li className="py-2 text-[13.5px] text-ink-3">No changes passed the checks; your resume already fits this post as written.</li>}
    </ul>
  );
}

/** Lines that differ between two versions of the same resume. */
function differingLines(a: string, b: string): Set<string> {
  const other = new Set(b.split("\n").map((l) => l.trim()));
  return new Set(a.split("\n").map((l) => l.trim()).filter((l) => l && !other.has(l)));
}

export function TailorCard({ messageId, p }: { messageId: string; p: TailorPayload }) {
  const [view, setView] = useState<"mine" | "compare">("mine");
  const [loading, setLoading] = useState(false);
  const app = useLiveQuery(() => db.applications.get(p.applicationId), [p.applicationId]);
  const r = p.result;
  if (!r) return <p className="text-[14px] text-danger">{p.error ?? "Couldn't tailor the resume."}</p>;
  const learnedUsed = r.applied.filter((id) => id.startsWith("learned/")).length;
  const diff = p.baseline ? differingLines(r.text, p.baseline.text) : null;

  return (
    <article className="settle rounded-2xl border border-line bg-surface" aria-label="Tailored resume">
      <header className="px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold">Tailored resume</h3>
          <span className="rounded-full bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{r.source === "ai" ? "AI, checked by code" : "Rules only"}</span>
          {learnedUsed > 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px]">{learnedUsed} of your rules applied</span>}
        </div>
        <p className="mt-1 text-[13px] text-ink-2">
          {app ? `${app.role}${app.company ? ` · ${app.company}` : ""}. ` : ""}Only lines already in your resume, reordered and reworded. Every change shows the rule behind it.
        </p>
        <div className="mt-3 inline-flex rounded-lg border border-line p-0.5 text-[13px]" role="tablist" aria-label="Which version">
          <button type="button" role="tab" aria-selected={view === "mine"} className={`rounded-md px-3 py-1 ${view === "mine" ? "bg-sunk font-medium" : "text-ink-2"}`} onClick={() => setView("mine")}>
            Personalized
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "compare"}
            className={`rounded-md px-3 py-1 ${view === "compare" ? "bg-sunk font-medium" : "text-ink-2"}`}
            onClick={async () => {
              setView("compare");
              if (!p.baseline && !loading) {
                setLoading(true);
                await loadBaselineTailor(messageId, p);
                setLoading(false);
              }
            }}
          >
            Compare with baseline skills
          </button>
        </div>
      </header>

      {view === "mine" ? (
        <div className="border-t border-line px-4 py-2">
          <Changes r={r} />
        </div>
      ) : (
        <div className="grid gap-4 border-t border-line px-4 py-3 md:grid-cols-2">
          <div>
            <p className="text-[12.5px] font-medium">Personalized</p>
            <p className="text-[12px] text-ink-3">Baseline skills + your learned layer</p>
            <ResumeText text={r.text} highlight={diff} label="Personalized resume" />
          </div>
          <div>
            <p className="text-[12.5px] font-medium">Baseline skills only</p>
            <p className="text-[12px] text-ink-3">The same skills with nothing learned</p>
            {p.baseline ? <ResumeText text={p.baseline.text} highlight={differingLines(p.baseline.text, r.text)} label="Baseline-only resume" /> : <p className="mt-2 text-[13px] text-ink-3">{loading ? "Tailoring with the baseline skills…" : p.error ?? "Loading…"}</p>}
          </div>
          {diff && <p className="text-[12px] text-ink-3 md:col-span-2">Highlighted lines differ between the two. Each personalized change is listed, with its rule, under Personalized.</p>}
        </div>
      )}

      {r.missing.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-[13px] text-ink-2">
          <span className="font-medium text-ink">Asked for, not on your resume: </span>
          {r.missing.map((t) => `“${t}”`).join(", ")}. Add them yourself only where they&apos;re true; the app never inserts them.
        </p>
      )}
      {r.talkingPoints.length > 0 && (
        <div className="border-t border-line px-4 py-2 text-[13px]">
          <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Cover letter talking points</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {r.talkingPoints.map((t) => (
              <li key={t.quote}>
                {t.text} <span className="text-ink-3">From your resume: “{t.quote}”</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.rejected.length > 0 && (
        <details className="border-t border-line px-4 py-2 text-[13px]">
          <summary className="cursor-pointer text-ink-2">{r.rejected.length} suggested change{r.rejected.length === 1 ? " was" : "s were"} blocked by the checks</summary>
          <ul className="mt-1 space-y-1">
            {r.rejected.map((x, i) => (
              <li key={i}>
                <span className="text-ink-2">“{x.what}”</span> <span className="text-danger">{x.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {r.context ? (
        <WhatTheAISaw m={r.context} />
      ) : (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-3">AI is off, so this version only reorders your bullets by relevance to the post and by your accepted outreach rules. No wording was changed.</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <span className="mr-auto text-[12px] text-ink-3">{p.savedAt ? "Kept for this application. Its outcome will score the rules it used." : "Keep it to record which rules this application used."}</span>
        <Button variant={p.savedAt ? "ghost" : "secondary"} disabled={Boolean(p.savedAt)} onClick={() => void keepTailored(messageId, p)}>
          {p.savedAt ? "Kept" : "Keep for this application"}
        </Button>
        <CopyButton text={r.text} label="Copy resume" />
      </div>
    </article>
  );
}

const NBSP = String.fromCharCode(160);

function ResumeText({ text, highlight, label }: { text: string; highlight: Set<string> | null; label: string }) {
  return (
    <div tabIndex={0} role="region" aria-label={label} className="mt-2 max-h-96 overflow-auto rounded-lg border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed">
      {text.split("\n").map((l, i) => (
        <div key={i} className={highlight?.has(l.trim()) ? "-mx-1 rounded bg-accent-soft px-1" : ""}>
          {l || NBSP}
        </div>
      ))}
    </div>
  );
}

export function InterviewCard({ p }: { p: InterviewPayload }) {
  const app = useLiveQuery(() => db.applications.get(p.applicationId), [p.applicationId]);
  const r = p.result;
  return (
    <article className="settle rounded-2xl border border-line bg-surface" aria-label="Interview prep">
      <header className="px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold">Interview prep</h3>
          {r && <span className="rounded-full bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{r.source === "ai" ? "AI, checked by code" : "From the job post"}</span>}
        </div>
        <p className="mt-1 text-[13px] text-ink-2">
          {app ? `${app.role}${app.company ? ` · ${app.company}` : ""}. ` : ""}Each story uses only your resume. Fill every {FILL} with what really happened.
        </p>
      </header>
      {!r ? (
        <p className="border-t border-line px-4 py-3 text-[13.5px] text-ink-3">{p.error ?? "Preparing questions…"}</p>
      ) : (
        <>
          <ol className="divide-y divide-line border-t border-line">
            {r.prep.questions.map((q, i) => (
              <li key={i} className="px-4 py-3">
                <p className="text-[15px] font-medium leading-snug">{q.question}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">Tests: {q.requirement}</p>
                {q.quote && <p className="mt-1 text-[13px] text-ink-2">Your line: “{q.quote}”</p>}
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[6rem_1fr]">
                  {(["situation", "task", "action", "result"] as const).map((k) => (
                    <div key={k} className="contents">
                      <dt className="capitalize text-ink-3">{k}</dt>
                      <dd className={q.star[k] === FILL ? "text-warn" : ""}>{q.star[k]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
          {r.prep.questionsForThem.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-[13px]">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Questions to ask them</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{r.prep.questionsForThem.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          {r.fixed > 0 && <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-3">{r.fixed} detail{r.fixed === 1 ? "" : "s"} the resume didn&apos;t support {r.fixed === 1 ? "was" : "were"} replaced with {FILL}.</p>}
          <WhatTheAISaw m={r.context} />
        </>
      )}
    </article>
  );
}

export function skillName(id: SkillId): string {
  return SKILLS[id].name;
}

export { TIER_TEXT };
