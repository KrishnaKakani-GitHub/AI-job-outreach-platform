"use client";
/**
 * "Craft this application": personal suggestions for the job just pasted,
 * each with the reason, the evidence tier, and links to the past
 * applications it's based on.
 */
import { useLiveQuery } from "dexie-react-hooks";
import type { CraftPayload } from "@/client/assistant";
import { db } from "@/client/db";
import type { Reco } from "@/lib/learn";
import { localManifest } from "@/lib/skills/personal";
import { Button, EvidenceBadge } from "./ui";
import { WhatTheAISaw } from "./SkillCards";

const ORDER: Reco["kind"][] = ["rule", "jobtype", "resume", "gap", "lead", "network", "recipient", "opener", "family", "language"];

export function CraftCard({ p, busy = false, onTailor }: { p: CraftPayload; busy?: boolean; onTailor?: () => void }) {
  const { craft } = p;
  const app = useLiveQuery(() => db.applications.get(p.applicationId), [p.applicationId]);
  const recos = [...craft.recos].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const { progress } = craft;

  async function toggleTweak(gap: NonNullable<Reco["gap"]>, on: boolean) {
    const a = await db.applications.get(p.applicationId);
    if (!a) return;
    const tweaks = on ? [...new Set([...a.tweaks, gap])] : a.tweaks.filter((t) => t !== gap);
    await db.applications.update(a.id, { tweaks });
  }

  return (
    <article className="settle rounded-2xl border border-line bg-surface" aria-label="Craft this application">
      <header className="px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold">Craft this application</h3>
          <EvidenceBadge tier={progress.tier} />
        </div>
        <p className="mt-1 text-[13px] text-ink-2">
          {progress.tier === "job_post"
            ? "From this job post and your resume."
            : craft.scope === "similar"
              ? `From your ${craft.similarCount} most similar applications (${craft.pool.successes} got a response, ${craft.pool.failures} didn't), out of ${progress.resolved} with an outcome.`
              : `From all ${progress.resolved} applications with an outcome: ${progress.successes} got a response, ${progress.failures} didn't.`}{" "}
          <span className="text-ink-3">{progress.next}</span>
        </p>
      </header>
      <ul className="divide-y divide-line border-t border-line">
        {recos.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] font-medium uppercase tracking-wide text-ink-3">{r.title}</p>
              {r.tier !== progress.tier || r.tier !== "job_post" ? <EvidenceBadge tier={r.tier} /> : null}
            </div>
            <p className="mt-1 text-[15px] font-medium leading-snug">{r.advice}</p>
            <p className="mt-0.5 text-[13.5px] text-ink-2">{r.why}</p>
            {r.evidence.length > 0 && (
              <details className="mt-1.5 text-[12.5px]">
                <summary className="cursor-pointer text-ink-3 hover:text-ink">Based on {r.evidence.length} past application{r.evidence.length === 1 ? "" : "s"}</summary>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {r.evidence.map((e) => (
                    <li key={e.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${e.outcome === "success" ? "bg-accent" : e.outcome === "failure" ? "bg-ink-3" : "bg-line"}`} aria-hidden />
                      {e.label}
                      <span className="sr-only">{e.outcome === "success" ? "(got a response)" : "(no response)"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {r.kind === "gap" && r.gap && app && (
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={app.tweaks.includes(r.gap)} onChange={(e) => void toggleTweak(r.gap!, e.target.checked)} />
                I fixed this in my resume for this application
              </label>
            )}
          </li>
        ))}
      </ul>
      {p.context && <WhatTheAISaw m={localManifest("craft", "craft", p.context)} computed />}
      {onTailor && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="mr-auto text-[12.5px] text-ink-2">Apply these with your skills, using only lines already in your resume.</span>
          <Button variant="primary" disabled={busy} onClick={onTailor}>Tailor my resume for this job</Button>
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-[11.5px] text-ink-3">
        Patterns from your own history, not guarantees. Every number is computed from your tracker; nothing here leaves your browser.
      </p>
    </article>
  );
}
