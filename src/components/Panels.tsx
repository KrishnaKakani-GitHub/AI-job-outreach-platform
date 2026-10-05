"use client";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Application, GapTag, Profile } from "@/lib/schemas";
import { computeInsights, familyOf, rate } from "@/lib/insights";
import { groupBy, jdPatterns, messageStats, outreachChains, resolvedApps, tierProgress, TIER_PATTERN, TIER_PERSONAL } from "@/lib/learn";
import { stallPoints } from "@/lib/strategy";
import { jobTypeProfiles, overallRate, ruleRecos, SIGNAL_TEXT, targetingSignal, type JobTypeProfile } from "@/lib/jobtypes";
import { scoreAll, type RuleScore } from "@/lib/skills/score";
import { learnedTargets } from "@/lib/skills/personal";
import { RULE_BY_ID } from "@/lib/skills/catalog";
import { RECIPIENT_LABELS } from "@/lib/draft";
import { refreshPlaybook, setRuleStatus } from "@/client/learning";
import { Button, EvidenceBadge } from "./ui";
import { GAP_LABELS } from "@/lib/fit";
import { clearAll, db, EMPTY_PROFILE, saveProfile } from "@/client/db";
import { LineChart, pct, RateRow } from "./charts";
import { IconClose } from "./icons";
import { COMPANY_LABEL, isStatedReason, labelFor, OPENER_LABEL, REASON_LABEL, SENIORITY_LABEL } from "@/lib/labels";

export function PanelFrame({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className={`fixed inset-y-0 right-0 z-40 flex w-full ${wide ? "max-w-[44rem]" : "max-w-[34rem]"} flex-col border-l border-line bg-surface shadow-[-12px_0_40px_-24px_rgba(0,0,0,0.35)]`} role="dialog" aria-modal="false" aria-label={title}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-sunk" aria-label={`Close ${title}`}>
          <IconClose />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}

function useRecords(demo: boolean) {
  const apps = useLiveQuery(() => db.applications.filter((a) => a.demo === demo).sortBy("createdAt"), [demo]) ?? [];
  const contacts = useLiveQuery(() => db.contacts.filter((c) => c.demo === demo).toArray(), [demo]) ?? [];
  return { apps, contacts };
}

export function InsightsPanel({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const { apps, contacts } = useRecords(demo);
  const [now] = useState(() => Date.now());
  const rules = useLiveQuery(() => db.playbook.filter((r) => r.demo === demo).toArray(), [demo]) ?? [];
  const resolvedCount = resolvedApps(apps, now).length;
  useEffect(() => {
    void refreshPlaybook(demo);
  }, [demo, resolvedCount, contacts.length]);

  if (!apps.length) {
    return (
      <PanelFrame title="Insights" onClose={onClose}>
        <div className="py-8 text-center">
          <p className="text-[15px] font-medium">Nothing to learn from yet</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[13.5px] text-ink-2">
            Paste a job post or add an application in the Tracker. Suggestions start from the job post itself and get personal after {TIER_PERSONAL} outcomes.
          </p>
          <p className="mt-6 text-[13px] text-ink-3">Want to see it first? Turn on demo data in the sidebar.</p>
        </div>
      </PanelFrame>
    );
  }

  const ins = computeInsights(apps, contacts);
  const progress = tierProgress(apps, now);
  const resolved = resolvedApps(apps, now);
  const messaged = contacts.filter((c) => c.message);
  const openers = messageStats(messaged, now, (c) => c.message!.opener).map((x) => rate(x.key, x.s, x.n));
  const types = messageStats(messaged, now, (c) => c.recipientType).map((x) => rate(x.key, x.s, x.n));
  const chains = outreachChains(apps, contacts, now);
  const patterns = jdPatterns(resolved);
  const stalls = stallPoints(apps);
  const famVersion = groupBy(resolved, (r) => `${familyOf(r.app)}|${r.app.resumeVersion}`);
  const reasons = apps.filter((a) => a.outcome && a.outcome.reasonCategory !== "none_given");
  const stated = reasons.filter((a) => isStatedReason(a.outcome!.reasonSource));
  const guessed = reasons.filter((a) => !isStatedReason(a.outcome!.reasonSource));
  const next = progress.tier === "job_post" ? TIER_PERSONAL : progress.tier === "early" ? TIER_PATTERN : null;
  const profiles = jobTypeProfiles(apps, now);
  const overall = overallRate(apps, now);
  const scores = scoreAll(apps, contacts, now, learnedTargets(rules));
  const visibleRules = rules.filter((r) => r.status !== "rejected" && r.current).sort((x, y) => (x.status === y.status ? 0 : x.status === "accepted" ? -1 : 1));

  return (
    <PanelFrame title={demo ? "Insights (demo data)" : "Insights"} onClose={onClose}>
      <div className="space-y-7">
        <section className="rounded-xl border border-line p-4" aria-label="How much the app has learned">
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceBadge tier={progress.tier} />
            <span className="text-[13.5px] text-ink-2">
              {progress.resolved} outcome{progress.resolved === 1 ? "" : "s"}: {progress.successes} got a response, {progress.failures} didn&apos;t
            </span>
          </div>
          {next && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-grid" role="progressbar" aria-label="Progress to the next evidence level" aria-valuemin={0} aria-valuemax={next} aria-valuenow={Math.min(progress.resolved, next)}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, progress.resolved / next) * 100}%` }} />
            </div>
          )}
          <p className="mt-2 text-[12.5px] text-ink-3">{progress.next} A success is any response; a failure is a rejection or no response after 21 days.</p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Tile label="Application to interview" value={pct(ins.interviewConversion.rate)} sub={`${ins.interviewConversion.k} of ${ins.interviewConversion.n} applications`} />
          <Tile label="Average alignment" value={ins.avgAlignment === null ? "None yet" : String(ins.avgAlignment)} sub="fit score out of 100" />
        </div>

        <Block title="By job type" note="What each kind of role asks for, and what went with a response for you. Small job types lean on your overall rate until they have data of their own.">
          {profiles.length ? (
            <ul className="space-y-3">
              {profiles.map((p) => <JobTypeRow key={p.family} p={p} overall={overall} scores={scores} />)}
            </ul>
          ) : (
            <Empty>Patterns per job type appear once applications have outcomes.</Empty>
          )}
        </Block>

        <Block title="What was on your resume when you got interviews" note="For each interview, the insights the resume you sent followed. Across many interviews, this is what to keep building on.">
          <InterviewInsights apps={apps} rules={rules} scores={scores} />
        </Block>

        <Block title="Your playbook" note="Rules learned from your own outcomes. Accepted rules shape every suggestion and AI draft.">
          {visibleRules.length === 0 ? (
            <p className="text-[13.5px] text-ink-3">{progress.tier === "job_post" ? `Rules appear once personal suggestions start (${TIER_PERSONAL} outcomes with at least one response and one without).` : "No clear rules yet. They appear when one choice clearly beats the alternatives."}</p>
          ) : (
            <ul className="space-y-2.5">
              {visibleRules.map((r) => (
                <li key={r.id} className={`rounded-lg border p-3 ${r.status === "accepted" ? "border-accent/50 bg-accent-soft/40" : "border-line"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <EvidenceBadge tier={r.tier} />
                    <span className="text-[11.5px] uppercase tracking-wide text-ink-3">{r.scope === "message" ? "Outreach" : r.scope === "resume" ? "Resume" : "Targeting"}{r.family ? ` · ${r.family}` : ""}</span>
                    {r.status === "accepted" && <span className="text-[11.5px] font-medium text-accent">In use</span>}
                  </div>
                  <p className="mt-1 text-[14.5px] font-medium">{r.text}</p>
                  <p className="text-[12.5px] text-ink-2">{r.evidence}</p>
                  <div className="mt-2 flex gap-1">
                    {r.status !== "accepted" && <Button variant="primary" className="!px-2.5 !py-1 !text-[12.5px]" onClick={() => void setRuleStatus(r.id, "accepted")}>Use this rule</Button>}
                    {r.status === "accepted" ? (
                      <Button variant="ghost" className="!px-2.5 !py-1 !text-[12.5px]" onClick={() => void setRuleStatus(r.id, "proposed")}>Stop using</Button>
                    ) : (
                      <Button variant="ghost" className="!px-2.5 !py-1 !text-[12.5px]" onClick={() => void setRuleStatus(r.id, "rejected")}>Dismiss</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {rules.some((r) => !r.current && r.status === "accepted") && <p className="mt-2 text-[12.5px] text-warn">Some accepted rules are no longer supported by your latest outcomes, so they&apos;re paused.</p>}
        </Block>

        <Block title="Which openings get accepted" note="Share of sent invites that were accepted or better, by how the message opened.">
          {openers.length ? openers.map((r) => <RateRow key={r.key} r={r} label={labelFor(OPENER_LABEL, r.key)} />) : <Empty>Copy a few drafts and update their stage in the Tracker.</Empty>}
        </Block>
        <Block title="Who accepts">
          {types.length ? types.map((r) => <RateRow key={r.key} r={r} label={labelFor(RECIPIENT_LABELS, r.key)} />) : <Empty>No resolved invites yet.</Empty>}
        </Block>
        <Block title="From outreach to outcome" note="Your best-performing threads, from the first message to the furthest result.">
          {chains.length ? (
            <ul className="space-y-2">
              {chains.map((c) => (
                <li key={c.appId} className="text-[13px]">
                  <p className="font-medium">{c.role}{c.company ? ` · ${c.company}` : ""}</p>
                  <p className="text-ink-2">{c.steps.join(" → ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Chains appear once a drafted message is linked to an application.</Empty>
          )}
        </Block>
        <Block title="Role family × resume version" note="Response rate for each combination you've tried.">
          {famVersion.length ? famVersion.map((l) => {
            const [fam, ver] = l.level.split("|");
            return <RateRow key={l.level} r={rate(l.level, l.s, l.n)} label={`${fam} · ${ver}`} />;
          }) : <Empty>No outcomes yet.</Empty>}
        </Block>
        <Block title="Job-post patterns" note="Words in postings that go with a higher or lower response rate for you.">
          {patterns.length ? (
            <ul className="space-y-1 text-[13.5px]">
              {patterns.map((t) => (
                <li key={t.term} className="flex justify-between gap-3">
                  <span>“{t.term}”</span>
                  <span className="tabular-nums text-ink-2">
                    with: {t.with.s}/{t.with.n} · without: {t.without.s}/{t.without.n}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Needs a few outcomes across different postings.</Empty>
          )}
        </Block>

        <Block title="Where rejections happen">
          {stalls.length ? (
            <ul className="space-y-1 text-[14px]">
              {stalls.map((x) => (
                <li key={x.label} className="flex justify-between"><span>{x.label}</span><span className="tabular-nums text-ink-2">{x.count}</span></li>
              ))}
            </ul>
          ) : (
            <Empty>No rejections logged.</Empty>
          )}
        </Block>
        <Block title="Rejection reasons" note="What employers actually said, kept separate from guesses.">
          {reasons.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ReasonList title={`Stated by the employer (${stated.length})`} apps={stated} />
              <ReasonList title={`My guesses (${guessed.length})`} apps={guessed} />
            </div>
          ) : (
            <Empty>Use “Log outcome” in the Tracker to record reasons.</Empty>
          )}
        </Block>

        <Block title="Fit score over time">
          <LineChart points={ins.fitTrend.map((t) => ({ x: t.week, y: t.avg, note: `${t.n} posts` }))} yMax={100} yLabel="Average fit score by week" />
        </Block>
        <Block title="Rejection rate by role" note="Bars show the rate; the thin line is the 95% range.">
          {ins.rejectionByRole.map((r) => <RateRow key={r.key} r={r} />)}
        </Block>
        <Block title="Rejection rate by seniority">
          {ins.rejectionBySeniority.map((r) => <RateRow key={r.key} r={r} label={labelFor(SENIORITY_LABEL, r.key)} />)}
        </Block>
        <Block title="Most frequent resume gaps">
          <ul className="space-y-1 text-[14px]">
            {ins.topGaps.map((g) => (
              <li key={g.tag} className="flex justify-between"><span>{GAP_LABELS[g.tag as GapTag]}</span><span className="tabular-nums text-ink-2">{g.count}</span></li>
            ))}
          </ul>
        </Block>
        <Block title="Resume versions" note="Response rate, then interview rate.">
          {ins.resumeVersions.map((v) => (
            <div key={v.version}>
              <RateRow r={v.response} label={`${v.version} response`} />
              <RateRow r={v.interview} label={`${v.version} interview`} />
            </div>
          ))}
        </Block>
        <Block title="Response rate by company type">
          {ins.responseByCompanyType.map((r) => <RateRow key={r.key} r={r} label={labelFor(COMPANY_LABEL, r.key)} />)}
        </Block>
        <Block title="Roles with the strongest alignment">
          <ul className="space-y-1 text-[14px]">
            {ins.strongestRoles.map((r) => (
              <li key={r.family} className="flex justify-between gap-3">
                <span>{r.family}</span>
                <span className="tabular-nums text-ink-2">fit {r.avgFit} · {r.n} applied</span>
              </li>
            ))}
          </ul>
        </Block>
      </div>
    </PanelFrame>
  );
}

function InterviewInsights({ apps, rules, scores }: { apps: Application[]; rules: { key: string; text: string }[]; scores: RuleScore[] }) {
  const text = (id: string) => (id.startsWith("learned/") ? (rules.find((r) => `learned/${r.key}` === id)?.text ?? id.slice(8)) : (RULE_BY_ID.get(id)?.text ?? id));
  const interviews = apps.filter((a) => a.history.some((h) => h.stage === "interview") || ["interview", "final_round", "offer"].includes(a.stage));
  const top = scores.filter((s) => s.metric === "interview" && s.family === null && s.status === "working").sort((a, b) => b.lift - a.lift).slice(0, 3);
  if (!interviews.length) return <Empty>Once an application reaches an interview, the insights its resume followed show up here.</Empty>;
  return (
    <div className="space-y-3 text-[13px]">
      {top.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-accent-soft/40 p-2.5">
          {top.map((s) => (
            <li key={s.id}>
              <span className="font-medium">{text(s.id)}</span> <span className="text-ink-2">Followed: {s.with.s} of {s.with.n} got an interview; not followed: {s.without.s} of {s.without.n}.</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-2">
        {interviews.slice(-6).reverse().map((a) => {
          const ids = [...new Set([...(a.cv?.rules ?? []), ...(a.trace ?? [])].filter((x) => !x.startsWith("!")))];
          return (
            <li key={a.id}>
              <p className="font-medium">{a.role}{a.company ? ` · ${a.company}` : ""} <span className="font-normal text-ink-3">{familyOf(a)}{a.cv?.tailored ? " · tailored resume" : ""}</span></p>
              {ids.length ? <p className="text-ink-2">{ids.slice(0, 4).map(text).join(" · ")}{ids.length > 4 ? ` · and ${ids.length - 4} more` : ""}</p> : <p className="text-ink-3">The resume for this one wasn&apos;t recorded.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function JobTypeRow({ p, overall, scores }: { p: JobTypeProfile; overall: number; scores: RuleScore[] }) {
  const signal = targetingSignal(p, overall);
  const works = ruleRecos(scores, p.family);
  return (
    <li className="rounded-lg border border-line p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14.5px] font-medium">{p.family}</span>
        <EvidenceBadge tier={p.tier} />
        <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${signal === "apply_more" ? "bg-accent-soft text-ink" : signal === "apply_less" ? "bg-warn-soft text-warn" : "bg-sunk text-ink-3"}`} title={`Compared with ${pct(overall)} across all your applications`}>
          {SIGNAL_TEXT[signal]}
        </span>
        <span className="ml-auto tabular-nums text-ink-2">
          {p.s} of {p.n} got a response
          <span className="text-ink-3"> · range {pct(p.ci.low)} to {pct(p.ci.high)}</span>
        </span>
      </div>
      {p.commonAsks.length > 0 && (
        <p className="mt-1.5 text-ink-2">
          <span className="text-ink-3">Usually asks for: </span>
          {p.commonAsks.slice(0, 6).map((a) => a.term).join(", ")}
        </p>
      )}
      {p.coverage.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {p.coverage.slice(0, 3).map((c) => (
            <li key={c.term}>
              When the post asked for “{c.term}” and your resume showed it: <span className="tabular-nums font-medium">{c.covered.s} of {c.covered.n}</span>; when it didn&apos;t: <span className="tabular-nums">{c.uncovered.s} of {c.uncovered.n}</span>
            </li>
          ))}
        </ul>
      )}
      {works.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {works.map((w) => (
            <li key={w.id}>
              <span className="text-ink-3">{w.title.split(": ")[1] === "what went with interviews" ? "Went with interviews: " : "Works for you here: "}</span>
              {w.advice} <span className="text-ink-3">({w.why.replace(/^[^:]+: /, "")})</span>
            </li>
          ))}
        </ul>
      )}
      {p.posts.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-ink-2">
          {p.posts.map((f) => (
            <li key={f.feature}>
              {f.feature}: “{f.best.level}” {f.best.s} of {f.best.n}; other posts {f.rest.s} of {f.rest.n}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-ink-3">{children}</p>;
}

function ReasonList({ title, apps }: { title: string; apps: Application[] }) {
  const counts = new Map<string, number>();
  for (const a of apps) counts.set(a.outcome!.reasonCategory, (counts.get(a.outcome!.reasonCategory) ?? 0) + 1);
  return (
    <div>
      <p className="text-[12.5px] text-ink-3">{title}</p>
      <ul className="mt-1 space-y-0.5 text-[13.5px]">
        {[...counts.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => (
          <li key={k} className="flex justify-between gap-2"><span>{labelFor(REASON_LABEL, k)}</span><span className="tabular-nums text-ink-2">{n}</span></li>
        ))}
        {!counts.size && <li className="text-ink-3">None</li>}
      </ul>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[12px] text-ink-3">{sub}</p>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[14px] font-medium">{title}</h3>
      {note && <p className="text-[12px] text-ink-3">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const stored = useLiveQuery(() => db.profile.get("me").then((p) => p ?? EMPTY_PROFILE));
  return (
    <PanelFrame title="Your profile" onClose={onClose}>
      {stored ? <ProfileForm initial={stored} /> : <p className="text-[14px] text-ink-3">Loading…</p>}
    </PanelFrame>
  );
}

function ProfileForm({ initial }: { initial: Profile }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-accent";
  return (
    <>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveProfile(draft);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        <label className="block text-[13px] text-ink-2">
          Name (used in sign-offs)
          <input className={`${field} mt-1`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="block text-[13px] text-ink-2">
          Background, two lines about you
          <textarea className={`${field} mt-1 min-h-20`} value={draft.background} onChange={(e) => setDraft({ ...draft, background: e.target.value })} />
        </label>
        <label className="block text-[13px] text-ink-2">
          Resume (plain text)
          <textarea className={`${field} mt-1 min-h-48 font-mono text-[12.5px]`} value={draft.resume} onChange={(e) => setDraft({ ...draft, resume: e.target.value })} />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="text-[13px] text-ink-2">
            Resume version label
            <input className={`${field} mt-1 w-28`} value={draft.resumeVersion} onChange={(e) => setDraft({ ...draft, resumeVersion: e.target.value.slice(0, 40) })} />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-[13.5px]">
            <input type="checkbox" checked={draft.linkedinPremium} onChange={(e) => setDraft({ ...draft, linkedinPremium: e.target.checked })} className="accent-[var(--accent)]" />
            LinkedIn Premium (300-character invite notes)
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink">{saved ? "Saved" : "Save profile"}</button>
        </div>
        <p className="text-[12.5px] text-ink-3">Everything here stays in this browser. Pasted text is sent to the AI only for the request it&apos;s needed for, and isn&apos;t stored on the server.</p>
      </form>
      <div className="mt-8 border-t border-line pt-4">
        <button
          type="button"
          className="text-[13px] text-danger underline underline-offset-2"
          onClick={async () => {
            if (confirm("Delete your profile, applications, contacts and chats from this browser? This can't be undone.")) {
              await clearAll();
              location.reload();
            }
          }}
        >
          Delete all my data from this browser
        </button>
      </div>
    </>
  );
}
