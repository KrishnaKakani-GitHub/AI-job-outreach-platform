"use client";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { APP_STAGES, CONTACT_STAGES, type AppStage, type Application, type Contact, type ContactStage, type GapTag, type Profile } from "@/lib/schemas";
import { computeInsights, isApplied, UNLOCK_OUTREACH } from "@/lib/insights";
import { GAP_LABELS } from "@/lib/fit";
import { RECIPIENT_LABELS } from "@/lib/draft";
import { clearAll, db, EMPTY_PROFILE, saveProfile } from "@/client/db";
import { offerSimilarCompanies } from "@/client/assistant";
import { LineChart, pct, RateRow } from "./charts";
import { IconClose, IconLock } from "./icons";

const APP_STAGE_LABEL: Record<AppStage, string> = { saved: "Saved", applied: "Applied", responded: "Responded", interview: "Interview", final_round: "Final round", offer: "Offer", rejected: "Rejected" };
const CONTACT_STAGE_LABEL: Record<ContactStage, string> = { drafted: "Drafted", sent: "Sent", accepted: "Accepted", messaged: "Messaged", replied: "Replied", referral: "Referral" };
const FOLLOW_UP_DAYS = 3;

export function PanelFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[34rem] flex-col border-l border-line bg-surface shadow-[-12px_0_40px_-24px_rgba(0,0,0,0.35)]" role="dialog" aria-modal="false" aria-label={title}>
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

async function setAppStage(a: Application, stage: AppStage, chatId: string | null) {
  const next = { ...a, stage, history: [...a.history, { stage, at: Date.now() }] };
  await db.applications.put(next);
  if (stage === "rejected" && chatId) await offerSimilarCompanies(next, chatId);
}

async function setContactStage(c: Contact, stage: ContactStage) {
  await db.contacts.update(c.id, { stage, history: [...c.history, { stage, at: Date.now() }] });
}

export function TrackerPanel({ demo, chatId, onClose }: { demo: boolean; chatId: string | null; onClose: () => void }) {
  const { apps, contacts } = useRecords(demo);
  const applied = apps.filter(isApplied);
  const covered = applied.filter((a) => contacts.some((c) => c.applicationId === a.id && c.stage !== "drafted")).length;
  const [now] = useState(() => Date.now());

  return (
    <PanelFrame title={demo ? "Tracker (demo data)" : "Tracker"} onClose={onClose}>
      <p className="text-[13.5px] text-ink-2">
        Outreach coverage: <span className="font-medium text-ink">{applied.length ? pct(covered / applied.length) : "0%"}</span> of applied roles have at least one sent message ({covered} of {applied.length}).
      </p>
      {apps.length === 0 && <p className="mt-6 text-[14px] text-ink-3">Nothing tracked yet. Paste a job description in the chat and it shows up here.</p>}
      <ul className="mt-4 space-y-3">
        {[...apps].reverse().map((a) => {
          const cs = contacts.filter((c) => c.applicationId === a.id);
          return (
            <li key={a.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium">{a.role}</p>
                  <p className="text-[12.5px] text-ink-3">
                    {a.company ?? "Company not detected"}
                    {a.fit ? ` · fit ${a.fit.score}` : ""} · resume {a.resumeVersion}
                  </p>
                </div>
                <label className="shrink-0">
                  <span className="sr-only">Stage for {a.role}</span>
                  <select className="rounded-lg border border-line bg-paper px-2 py-1 text-[13px]" value={a.stage} onChange={(e) => void setAppStage(a, e.target.value as AppStage, chatId)}>
                    {APP_STAGES.map((s) => (
                      <option key={s} value={s}>{APP_STAGE_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
              </div>
              {cs.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
                  {cs.map((c) => {
                    const last = c.history[c.history.length - 1]?.at ?? c.createdAt;
                    const due = c.stage === "accepted" && now - last > FOLLOW_UP_DAYS * 86_400_000;
                    return (
                      <li key={c.id} className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0 truncate">
                          {c.firstName ?? "Contact"} <span className="text-ink-3">· {RECIPIENT_LABELS[c.recipientType]} · {c.variant === "A" ? "template" : "AI draft"}</span>
                          {due && <span className="ml-2 rounded bg-warn-soft px-1.5 text-[11.5px] text-warn">Follow up</span>}
                        </span>
                        <label>
                          <span className="sr-only">Stage for {c.firstName ?? "contact"}</span>
                          <select className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[12.5px]" value={c.stage} onChange={(e) => void setContactStage(c, e.target.value as ContactStage)}>
                            {CONTACT_STAGES.map((s) => (
                              <option key={s} value={s}>{CONTACT_STAGE_LABEL[s]}</option>
                            ))}
                          </select>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}

export function InsightsPanel({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const { apps, contacts } = useRecords(demo);
  const ins = computeInsights(apps, contacts);
  return (
    <PanelFrame title={demo ? "Insights (demo data)" : "Insights"} onClose={onClose}>
      {!ins.unlocked ? (
        <div className="py-8 text-center">
          <IconLock width={28} height={28} className="mx-auto text-ink-3" />
          <p className="mt-3 text-[15px] font-medium">Insights unlock after {UNLOCK_OUTREACH} sent messages</p>
          <p className="mx-auto mt-1 max-w-[36ch] text-[13.5px] text-ink-2">With fewer, the patterns are mostly noise. Copying a draft counts it as sent.</p>
          <div className="mx-auto mt-4 h-2 w-56 overflow-hidden rounded-full bg-grid" role="progressbar" aria-valuemin={0} aria-valuemax={UNLOCK_OUTREACH} aria-valuenow={ins.outreachCount}>
            <div className="h-full bg-accent" style={{ width: `${(ins.outreachCount / UNLOCK_OUTREACH) * 100}%` }} />
          </div>
          <p className="mt-2 text-[13px] tabular-nums text-ink-3">{ins.outreachCount} of {UNLOCK_OUTREACH}</p>
          <p className="mt-6 text-[13px] text-ink-3">Want to see it first? Turn on demo data in the sidebar.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Application to interview" value={ins.interviewConversion.enough ? pct(ins.interviewConversion.rate) : "Too few"} sub={`${ins.interviewConversion.k} of ${ins.interviewConversion.n} applications`} />
            <Tile label="Average alignment" value={ins.avgAlignment === null ? "None yet" : String(ins.avgAlignment)} sub="fit score out of 100" />
          </div>
          <Block title="Fit score over time">
            <LineChart points={ins.fitTrend.map((t) => ({ x: t.week, y: t.avg, note: `${t.n} posts` }))} yMax={100} yLabel="Average fit score by week" />
          </Block>
          <Block title="Rejection rate by role" note="Bars show the rate; the thin line is the 95% range.">
            {ins.rejectionByRole.map((r) => <RateRow key={r.key} r={r} />)}
          </Block>
          <Block title="Rejection rate by seniority">
            {ins.rejectionBySeniority.map((r) => <RateRow key={r.key} r={r} />)}
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
            {ins.responseByCompanyType.map((r) => <RateRow key={r.key} r={r} />)}
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
      )}
    </PanelFrame>
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
