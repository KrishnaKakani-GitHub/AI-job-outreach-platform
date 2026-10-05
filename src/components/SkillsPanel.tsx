"use client";
/**
 * The ten skills: baseline from ResumeSkills, plus the personal layer your
 * outcomes built. Shows what each learned, what it paused, its version
 * history, and exports the personal SKILL.md files for Claude.
 */
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/client/db";
import { exportSkills, personalMarkdown, refreshNoteRules, refreshPlaybook, refreshSkills, setRuleStatus, type SkillView } from "@/client/learning";
import { resolvedApps } from "@/lib/learn";
import { SKILLS } from "@/lib/skills/catalog";
import { evidenceText } from "@/lib/skills/score";
import { PanelFrame } from "./Panels";
import { MEMORY_GROUPS, MILESTONES, memoryToText, nextMilestone } from "@/lib/memory";
import { Button, EvidenceBadge } from "./ui";

export function SkillsPanel({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const apps = useLiveQuery(() => db.applications.filter((a) => a.demo === demo).toArray(), [demo]) ?? [];
  const rules = useLiveQuery(() => db.playbook.filter((r) => r.demo === demo).toArray(), [demo]) ?? [];
  const [views, setViews] = useState<SkillView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const resolved = resolvedApps(apps, now).length;
  const ruleSig = rules.map((r) => `${r.id}:${r.status}:${r.current}`).join("|");

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refreshPlaybook(demo);
      const v = await refreshSkills(demo);
      if (alive) setViews(v);
    })();
    return () => {
      alive = false;
    };
  }, [demo, resolved, ruleSig]);

  const accepted = views?.reduce((n, v) => n + v.accepted.length, 0) ?? 0;
  const proposed = views?.reduce((n, v) => n + v.proposed.length, 0) ?? 0;
  const scored = views?.reduce((n, v) => n + v.working.length + v.paused.length, 0) ?? 0;

  return (
    <PanelFrame title={demo ? "Skills (demo data)" : "Skills"} onClose={onClose} wide>
      <div className="space-y-5">
        <section className="rounded-xl border border-line p-4 text-[13.5px]">
          <p>
            Ten baseline skills from <a className="underline decoration-accent underline-offset-4" href="https://github.com/Paramchoudhary/ResumeSkills" target="_blank" rel="noreferrer">ResumeSkills</a> by Param Choudhary (MIT), unchanged. Each one grows a personal layer from your own outcomes: rules you accept, baseline advice your results support, and baseline advice they don&apos;t, which gets paused.
          </p>
          <p className="mt-2 text-ink-2">
            {views ? `${accepted} learned rule${accepted === 1 ? "" : "s"} in use, ${proposed} waiting for you, ${scored} baseline rule score${scored === 1 ? "" : "s"} with evidence.` : "Loading…"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!views || busy}
              onClick={async () => {
                if (!views) return;
                setBusy(true);
                try {
                  await exportSkills(views, `personal-skills-${new Date().toISOString().slice(0, 10)}.zip`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Download all for Claude
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await refreshNoteRules(demo);
                setBusy(false);
                setNotice(r.error ?? (r.proposed ? `${r.proposed} new rule${r.proposed === 1 ? "" : "s"} from your notes, waiting below.` : "No new rules in your notes."));
              }}
            >
              Learn from my outcome notes
            </Button>
          </div>
          {notice && <p className="mt-2 text-[12.5px] text-ink-2" role="status">{notice}</p>}
          <p className="mt-2 text-[12px] text-ink-3">The download has one folder per skill with a SKILL.md: your personal layer first, then the baseline skill unchanged. Not a retrained model: rules, scored against your outcomes.</p>
        </section>

        <Scale outcomes={resolved} />

        <ul className="space-y-2">
          {(views ?? []).map((v) => (
            <li key={v.id} className="rounded-xl border border-line">
              <button type="button" className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>
                <span className="text-[15px] font-medium">{v.name}</span>
                <span className="rounded-full bg-sunk px-2 py-0.5 text-[11.5px] text-ink-2">{v.version ? `Personal v${v.version}` : "Baseline"}</span>
                {v.accepted.length > 0 && <span className="text-[12px] text-ink-2">{v.accepted.length} learned</span>}
                {v.paused.length > 0 && <span className="text-[12px] text-warn">{v.paused.length} paused</span>}
                {v.proposed.length > 0 && <span className="text-[12px] font-medium text-accent">{v.proposed.length} to review</span>}
                <span className="basis-full text-[12.5px] text-ink-3">{SKILLS[v.id].does}</span>
              </button>
              {open === v.id && <SkillDetail v={v} />}
            </li>
          ))}
        </ul>
        <MemoryLog demo={demo} />
      </div>
    </PanelFrame>
  );
}

function Scale({ outcomes }: { outcomes: number }) {
  const next = nextMilestone(outcomes);
  return (
    <section className="rounded-xl border border-line p-4 text-[13px]" aria-label="How much your history can tell">
      <p className="font-medium">{outcomes} application{outcomes === 1 ? "" : "s"} with an outcome</p>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {MILESTONES.map((m) => (
          <li key={m.at} title={m.unlocks} className={`rounded-full px-2.5 py-0.5 tabular-nums ${outcomes >= m.at ? "bg-accent text-accent-ink" : "bg-sunk text-ink-3"}`}>
            {m.at}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-ink-2">{next ? `At ${next.at}: ${next.unlocks}.` : "You're past every milestone; the strongest patterns now have the data they need."} Every outcome re-scores every skill.</p>
    </section>
  );
}

function MemoryLog({ demo }: { demo: boolean }) {
  const [group, setGroup] = useState<number | null>(null);
  const entries = useLiveQuery(() => db.memory.filter((e) => e.demo === demo).toArray(), [demo]) ?? [];
  const shown = entries.filter((e) => group === null || MEMORY_GROUPS[group].kinds.includes(e.kind)).sort((a, b) => b.at - a.at);
  return (
    <section className="rounded-xl border border-line p-4" aria-label="Memory log">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-[15px] font-medium">Memory log</h3>
        <Button
          variant="ghost"
          disabled={!entries.length}
          onClick={() => {
            const blob = new Blob([memoryToText(entries)], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `memory-log-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Export
        </Button>
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-3">Every AI message, every resume you kept or sent, every interview and outcome, and every change the skills made because of them. Stays in this browser.</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[12.5px]" role="group" aria-label="Filter the memory log">
        {[null, ...MEMORY_GROUPS.map((_, i) => i)].map((g) => (
          <button key={g ?? "all"} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`rounded-full px-2.5 py-1 ${group === g ? "bg-ink text-paper" : "bg-sunk text-ink-2 hover:text-ink"}`}>
            {g === null ? "All" : MEMORY_GROUPS[g].label}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ol className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1" tabIndex={0} aria-label="Memory log entries">
          {shown.slice(0, 200).map((e) => (
            <li key={e.id} className="rounded-lg border border-line p-2.5 text-[13px]">
              <p className="text-[11.5px] text-ink-3">
                {new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {e.family ? ` · ${e.family}` : ""}
              </p>
              <p className="font-medium">{e.title}</p>
              {e.detail && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12.5px] text-ink-2">Details</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-[12.5px] text-ink-2">{e.detail}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">Nothing logged yet. Drafts, kept resumes, interviews and outcomes will appear here.</p>
      )}
    </section>
  );
}

function SkillDetail({ v }: { v: SkillView }) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="space-y-4 border-t border-line px-4 py-3 text-[13.5px]">
      {v.proposed.length > 0 && (
        <Group title="Waiting for you">
          {v.proposed.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <EvidenceBadge tier={r.tier} />
                {r.family && <span className="text-[11.5px] text-ink-3">{r.family}</span>}
              </div>
              <p className="mt-1 font-medium">{r.text}</p>
              <p className="text-[12.5px] text-ink-2">{r.evidence}</p>
              <div className="mt-1.5 flex gap-1">
                <Button variant="primary" className="!px-2.5 !py-1 !text-[12.5px]" onClick={() => void setRuleStatus(r.id, "accepted")}>Use this rule</Button>
                <Button variant="ghost" className="!px-2.5 !py-1 !text-[12.5px]" onClick={() => void setRuleStatus(r.id, "rejected")}>Dismiss</Button>
              </div>
            </li>
          ))}
        </Group>
      )}
      <Group title="Learned and in use" empty="Nothing yet. Rules appear here when you accept them.">
        {v.accepted.map((r) => (
          <li key={r.id}>
            <span className="mr-1.5 inline-block align-middle"><EvidenceBadge tier={r.tier} /></span>
            {r.text} <span className="text-ink-3">{r.family ? `${r.family}. ` : ""}{r.evidence}</span>
            <button type="button" className="ml-2 text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink" onClick={() => void setRuleStatus(r.id, "proposed")}>Stop using</button>
          </li>
        ))}
      </Group>
      <Group title="Baseline advice that works for you" empty="Scores appear once followed and not-followed applications both have outcomes.">
        {v.working.map((w) => (
          <li key={`${w.rule.id}|${w.score.family}`}>
            <span className="mr-1.5 inline-block align-middle"><EvidenceBadge tier={w.score.tier} /></span>
            {w.rule.text} <span className="text-ink-3">{evidenceText(w.score, w.rule.target)}</span>
          </li>
        ))}
      </Group>
      {v.paused.length > 0 && (
        <Group title="Paused for you">
          {v.paused.map((w) => (
            <li key={`${w.rule.id}|${w.score.family}`}>
              <span className="mr-1.5 inline-block align-middle"><EvidenceBadge tier={w.score.tier} /></span>
              {w.rule.text} <span className="text-ink-3">{evidenceText(w.score, w.rule.target)}</span>
            </li>
          ))}
        </Group>
      )}
      <Group title="Version history" empty="Version 0 is the baseline. A new version starts each time what the skill learned changes.">
        {[...v.history].reverse().map((h) => (
          <li key={h.id}>
            <p className="font-medium">
              Version {h.version} <span className="font-normal text-ink-3">{new Date(h.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </p>
            <ul className="list-disc pl-4 text-[12.5px] text-ink-2">
              {h.changes.slice(0, 8).map((c) => <li key={c}>{c}</li>)}
              {h.changes.length > 8 && <li>and {h.changes.length - 8} more</li>}
            </ul>
          </li>
        ))}
      </Group>
      <div className="flex flex-wrap gap-2">
        <Button onClick={async () => setPreview(preview ? null : await personalMarkdown(v))}>{preview ? "Hide SKILL.md" : "Preview SKILL.md"}</Button>
        <Button onClick={() => void exportSkills([v], `${v.id}-personal.zip`)}>Download for Claude</Button>
      </div>
      {preview && <pre tabIndex={0} aria-label={`${v.name} SKILL.md`} className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 font-mono text-[11.5px] leading-relaxed">{preview}</pre>}
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <section>
      <h4 className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{title}</h4>
      {items.length ? <ul className="mt-1 space-y-1.5">{children}</ul> : empty ? <p className="mt-1 text-[12.5px] text-ink-3">{empty}</p> : null}
    </section>
  );
}
