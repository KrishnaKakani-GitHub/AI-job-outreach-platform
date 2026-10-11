"use client";
/**
 * Tracker: applications and network in one panel. Records live only in
 * IndexedDB. Every write goes through a schema (records.ts) and every stage
 * move through lib/tracker.ts, so history and follow-up dates stay consistent.
 */
import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  APP_SOURCES,
  APP_STAGES,
  CONTACT_STAGES,
  JOB_TYPES,
  OUTCOME_RESULTS,
  REASON_CATEGORIES,
  REASON_SOURCES,
  RECIPIENT_TYPES,
  type AppSource,
  type AppStage,
  type Application,
  type Contact,
  type ContactStage,
  type JobType,
  type OutcomeLog,
  type RecipientType,
} from "@/lib/schemas";
import {
  APP_STAGE_LABEL,
  CONTACT_STAGE_LABEL,
  isStatedReason,
  OUTCOME_LABEL,
  REASON_LABEL,
  REASON_SOURCE_LABEL,
  SOURCE_LABEL,
} from "@/lib/labels";
import { RECIPIENT_LABELS } from "@/lib/draft";
import { recipientTypeFromTitle } from "@/lib/classify";
import { applicationsToCSV, connectionKey, parseApplicationsCSV, parseLinkedInConnections, type LinkedInConnection } from "@/lib/csv";
import { buildBackup, newApplication, newContact, parseBackup } from "@/lib/records";
import {
  applyOutcome,
  contactNeedsFollowUp,
  displayName,
  filterApplications,
  filterContacts,
  isClosed,
  isOverdue,
  moveApplication,
  trackerSummary,
  type AppFilter,
} from "@/lib/tracker";
import { uid } from "@/lib/text";
import { db, getProfile, importRecords } from "@/client/db";
import { afterStageChange, offerSimilarCompanies } from "@/client/assistant";
import { refreshNoteRules } from "@/client/learning";
import { familyOf, JOB_TYPE_LABEL, jobTypeOf } from "@/lib/insights";
import { followedRefs } from "@/lib/memory";
import { relearn, remember } from "@/client/memory";
import { pct } from "./charts";
import { PanelFrame } from "./Panels";
import { Button, Dialog, fromDateInput, Select, shortDate, TextField, toDateInput } from "./ui";
import { IconPlus } from "./icons";

type Tab = "apps" | "network";

function useRecords(demo: boolean) {
  const apps = useLiveQuery(() => db.applications.filter((a) => a.demo === demo).sortBy("createdAt"), [demo]) ?? [];
  const contacts = useLiveQuery(() => db.contacts.filter((c) => c.demo === demo).sortBy("createdAt"), [demo]) ?? [];
  return { apps, contacts };
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TrackerPanel({ demo, chatId, onClose }: { demo: boolean; chatId: string | null; onClose: () => void }) {
  const { apps, contacts } = useRecords(demo);
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("apps");
  const [editApp, setEditApp] = useState<Application | "new" | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<Application | null>(null);
  const [editContact, setEditContact] = useState<Contact | "new" | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInConnection[] | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = trackerSummary(apps, contacts, now);

  async function onFile(file: File) {
    const text = await file.text();
    setNotice(null);
    if (file.name.toLowerCase().endsWith(".json")) {
      const r = parseBackup(text);
      if (!r.ok) return setNotice({ kind: "error", text: r.error });
      const n = await importRecords(r.data.applications, r.data.contacts, r.data.profile);
      return setNotice({ kind: "ok", text: `Imported ${n.apps} applications and ${n.contacts} contacts.` });
    }
    const li = parseLinkedInConnections(text);
    if (li.ok) {
      setTab("network");
      return setLinkedin(li.rows);
    }
    const ac = parseApplicationsCSV(text, uid);
    if (!ac.ok) return setNotice({ kind: "error", text: ac.error });
    const rows = ac.rows.map((r) => newApplication({ ...r, demo }));
    await db.applications.bulkPut(rows);
    setNotice({ kind: "ok", text: `Imported ${rows.length} applications${ac.skipped ? `; skipped ${ac.skipped} rows without a role` : ""}.` });
  }

  async function exportJson() {
    const profile = demo ? null : ((await db.profile.get("me")) ?? null);
    const stamp = new Date().toISOString().slice(0, 10);
    download(`ai-job-tracker-backup-${stamp}.json`, JSON.stringify(buildBackup(profile, apps, contacts), null, 2), "application/json");
  }

  return (
    <PanelFrame title={demo ? "Tracker (demo data)" : "Tracker"} onClose={onClose} wide>
      <dl className="grid grid-cols-4 gap-2">
        <Stat label="Active" value={s.active} />
        <Stat label="Interviews" value={s.interviews} />
        <Stat label="Referrals" value={s.referrals} />
        <Stat label="Next move" value={s.nextMove} warn={s.nextMove > 0} />
      </dl>
      <p className="mt-2 text-[12.5px] text-ink-3">
        Outreach coverage: <span className="text-ink">{s.coverage.applied ? pct(s.coverage.covered / s.coverage.applied) : "0%"}</span> of applied roles have at least one sent message ({s.coverage.covered} of {s.coverage.applied}).
      </p>

      <div role="tablist" aria-label="Tracker sections" className="mt-4 flex gap-1 border-b border-line">
        {(
          [
            ["apps", `Applications (${apps.length})`],
            ["network", `Network (${contacts.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === k ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-[13px] ${notice.kind === "ok" ? "bg-accent-soft text-ink" : "bg-warn-soft text-warn"}`} role="status">
          {notice.text}
        </p>
      )}

      <div className="pt-3">
        {tab === "apps" ? (
          <ApplicationsTab
            apps={apps}
            contacts={contacts}
            now={now}
            onAdd={() => setEditApp("new")}
            onEdit={setEditApp}
            onOutcome={setOutcomeFor}
            onStage={async (a, stage) => {
              const moved = moveApplication(a, stage, Date.now());
              const next = { ...moved, ...(await afterStageChange(a, moved, chatId)) };
              await db.applications.put(next);
              if (stage === "rejected") {
                if (chatId) await offerSimilarCompanies(next, chatId);
                setOutcomeFor(next);
              }
            }}
          />
        ) : (
          <NetworkTab contacts={contacts} apps={apps} now={now} onAdd={() => setEditContact("new")} onEdit={setEditContact} onImport={() => fileRef.current?.click()} />
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[13px]">
        <span className="mr-auto text-ink-3">Your data stays in this browser. Back it up anytime.</span>
        <Button variant="ghost" onClick={() => void exportJson()}>Export backup</Button>
        <Button variant="ghost" onClick={() => download(`applications-${new Date().toISOString().slice(0, 10)}.csv`, applicationsToCSV(apps), "text/csv")}>Export CSV</Button>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>Import file</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          className="sr-only"
          aria-label="Import a backup, applications CSV, or LinkedIn Connections.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
      </div>

      {editApp && <ApplicationDialog app={editApp === "new" ? null : editApp} demo={demo} onClose={() => setEditApp(null)} />}
      {outcomeFor && <OutcomeDialog app={outcomeFor} onClose={() => setOutcomeFor(null)} />}
      {editContact && <ContactDialog contact={editContact === "new" ? null : editContact} apps={apps} demo={demo} onClose={() => setEditContact(null)} />}
      {linkedin && (
        <LinkedInImportDialog
          rows={linkedin}
          existing={contacts}
          demo={demo}
          onClose={() => setLinkedin(null)}
          onDone={(n) => {
            setLinkedin(null);
            setNotice({ kind: "ok", text: `Added ${n} contacts from LinkedIn.` });
          }}
        />
      )}
    </PanelFrame>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className={`text-[20px] font-semibold leading-tight tabular-nums ${warn ? "text-warn" : ""}`}>{value}</dd>
    </div>
  );
}

const STAGE_FILTERS: [AppFilter["stage"], string][] = [["all", "All stages"], ["open", "Open"], ["closed", "Closed"], ...APP_STAGES.map((s) => [s, APP_STAGE_LABEL[s]] as [AppStage, string])];
const SOURCE_FILTERS: [AppFilter["source"], string][] = [["all", "All sources"], ...APP_SOURCES.map((s) => [s, SOURCE_LABEL[s]] as [AppSource, string])];

function ApplicationsTab({
  apps,
  contacts,
  now,
  onAdd,
  onEdit,
  onOutcome,
  onStage,
}: {
  apps: Application[];
  contacts: Contact[];
  now: number;
  onAdd: () => void;
  onEdit: (a: Application) => void;
  onOutcome: (a: Application) => void;
  onStage: (a: Application, s: AppStage) => Promise<void>;
}) {
  const [f, setF] = useState<AppFilter>({ q: "", stage: "all", source: "all" });
  const shown = filterApplications(apps, f);
  const groups: [string, Application[]][] = [
    ["Needs a move", shown.filter((a) => isOverdue(a, now))],
    ["In progress", shown.filter((a) => !isClosed(a) && a.stage !== "saved" && !isOverdue(a, now))],
    ["Saved", shown.filter((a) => a.stage === "saved" && !isOverdue(a, now))],
    ["Closed", shown.filter(isClosed)],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">Search applications</span>
          <input className="input text-[14px]" placeholder="Search applications" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </label>
        <Select label="Filter by stage" hideLabel value={f.stage} options={STAGE_FILTERS} onChange={(v) => setF({ ...f, stage: v as AppFilter["stage"] })} />
        <Select label="Filter by source" hideLabel value={f.source} options={SOURCE_FILTERS} onChange={(v) => setF({ ...f, source: v as AppFilter["source"] })} />
        <Button variant="primary" onClick={onAdd} className="col-span-2 sm:col-span-1">
          <IconPlus width={15} height={15} /> Add application
        </Button>
      </div>
      {apps.length === 0 && <p className="mt-6 text-[14px] text-ink-3">Nothing tracked yet. Paste a job post in the chat, add one here, or import a CSV.</p>}
      {apps.length > 0 && shown.length === 0 && <p className="mt-6 text-[14px] text-ink-3">No applications match these filters.</p>}
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="mt-4">
            <h3 className="mb-2 text-[12.5px] font-medium uppercase tracking-wide text-ink-3">
              {title} <span className="font-normal">({list.length})</span>
            </h3>
            <ul className="space-y-2">
              {[...list].reverse().map((a) => (
                <AppRow key={a.id} a={a} contacts={contacts.filter((c) => c.applicationId === a.id)} now={now} onEdit={() => onEdit(a)} onOutcome={() => onOutcome(a)} onStage={(s) => void onStage(a, s)} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}

function AppRow({ a, contacts, now, onEdit, onOutcome, onStage }: { a: Application; contacts: Contact[]; now: number; onEdit: () => void; onOutcome: () => void; onStage: (s: AppStage) => void }) {
  const overdue = isOverdue(a, now);
  const meta = [a.company ?? "Company not set", a.location, a.appliedAt ? `applied ${shortDate(a.appliedAt)}` : null, a.fit ? `fit ${a.fit.score}` : null, `resume ${a.resumeVersion}`].filter(Boolean).join(" · ");
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-medium">{a.role}</p>
          <p className="truncate text-[12.5px] text-ink-3">{meta}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {a.source !== "cold" && <Pill>{SOURCE_LABEL[a.source]}</Pill>}
            {overdue && <Pill tone="warn">Follow up overdue</Pill>}
            {a.outcome && (
              <Pill tone={a.outcome.result === "offer" ? "good" : "plain"}>
                {OUTCOME_LABEL[a.outcome.result]}
                {a.outcome.reasonCategory !== "none_given" ? ` · ${REASON_LABEL[a.outcome.reasonCategory]}${isStatedReason(a.outcome.reasonSource) ? "" : " (my guess)"}` : ""}
              </Pill>
            )}
          </div>
          {a.nextStep && !isClosed(a) && (
            <p className="mt-1.5 text-[13px] text-ink-2">
              Next: {a.nextStep}
              {a.followUpAt ? <span className="text-ink-3"> · by {shortDate(a.followUpAt)}</span> : null}
            </p>
          )}
        </div>
        <Select label={`Stage for ${a.role}`} hideLabel size="sm" value={a.stage} options={APP_STAGES.map((s) => [s, APP_STAGE_LABEL[s]] as const)} onChange={(v) => onStage(v as AppStage)} className="w-32 shrink-0" />
      </div>
      {contacts.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {contacts.map((c) => (
            <ContactLine key={c.id} c={c} now={now} />
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1 text-[12.5px]">
        <Button variant="ghost" className="!px-2 !py-1 !text-[12.5px]" onClick={onOutcome}>Log outcome</Button>
        <Button variant="ghost" className="!px-2 !py-1 !text-[12.5px]" onClick={onEdit}>Edit</Button>
        {a.jobUrl && /^https?:\/\//i.test(a.jobUrl) && (
          <a href={a.jobUrl} target="_blank" rel="noreferrer noopener" className="rounded-lg px-2 py-1 text-ink-2 hover:bg-sunk hover:text-ink">
            Job post ↗
          </a>
        )}
      </div>
    </li>
  );
}

function ContactLine({ c, now }: { c: Contact; now: number }) {
  return (
    <li className="flex items-center justify-between gap-2 text-[13px]">
      <span className="min-w-0 truncate">
        {displayName(c)}{" "}
        <span className="text-ink-3">
          · {RECIPIENT_LABELS[c.recipientType]}
          {c.variant ? ` · ${c.variant === "A" ? "template" : "AI draft"}` : ""}
        </span>
        {contactNeedsFollowUp(c, now) && <span className="ml-2 rounded bg-warn-soft px-1.5 text-[11.5px] text-warn">Follow up</span>}
      </span>
      <Select
        label={`Stage for ${c.firstName ?? "contact"}`}
        hideLabel
        size="sm"
        value={c.stage}
        options={CONTACT_STAGES.map((s) => [s, CONTACT_STAGE_LABEL[s]] as const)}
        onChange={(v) => void db.contacts.update(c.id, { stage: v as ContactStage, history: [...c.history, { stage: v, at: Date.now() }] })}
        className="w-28 shrink-0"
      />
    </li>
  );
}

function Pill({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" | "good" }) {
  const cls = tone === "warn" ? "bg-warn-soft text-warn" : tone === "good" ? "bg-accent-soft text-ink" : "bg-sunk text-ink-2";
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] ${cls}`}>{children}</span>;
}

function NetworkTab({ contacts, apps, now, onAdd, onEdit, onImport }: { contacts: Contact[]; apps: Application[]; now: number; onAdd: () => void; onEdit: (c: Contact) => void; onImport: () => void }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("all");
  const shown = filterContacts(contacts, q, stage);
  const roleOf = useMemo(() => new Map(apps.map((a) => [a.id, a.company ? `${a.role} · ${a.company}` : a.role])), [apps]);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">Search contacts</span>
          <input className="input text-[14px]" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Select label="Filter contacts by stage" hideLabel value={stage} options={[["all", "All stages"], ...CONTACT_STAGES.map((s) => [s, CONTACT_STAGE_LABEL[s]] as const)]} onChange={setStage} />
        <Button onClick={onImport}>Import from LinkedIn</Button>
        <Button variant="primary" onClick={onAdd}>
          <IconPlus width={15} height={15} /> Add contact
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-3">
        Import uses LinkedIn&apos;s Connections.csv (Settings → Data privacy → Get a copy of your data → Connections). Only names, companies and positions are kept; email addresses are dropped.
      </p>
      {contacts.length === 0 && <p className="mt-6 text-[14px] text-ink-3">No contacts yet. Drafting a message adds one, or import your LinkedIn connections.</p>}
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
        {shown.slice(0, 300).map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">
                {displayName(c)}
                {contactNeedsFollowUp(c, now) && <span className="ml-2 rounded bg-warn-soft px-1.5 text-[11.5px] text-warn">Follow up</span>}
              </p>
              <p className="truncate text-[12.5px] text-ink-3">
                {[c.title, c.company, RECIPIENT_LABELS[c.recipientType], c.applicationId ? roleOf.get(c.applicationId) : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Select
              label={`Stage for ${displayName(c)}`}
              hideLabel
              size="sm"
              value={c.stage}
              options={CONTACT_STAGES.map((s) => [s, CONTACT_STAGE_LABEL[s]] as const)}
              onChange={(v) => void db.contacts.update(c.id, { stage: v as ContactStage, history: [...c.history, { stage: v, at: Date.now() }] })}
              className="w-28 shrink-0"
            />
            <Button variant="ghost" className="!px-2 !py-1 !text-[12.5px]" onClick={() => onEdit(c)}>Edit</Button>
          </li>
        ))}
      </ul>
      {shown.length > 300 && <p className="mt-2 text-[12.5px] text-ink-3">Showing 300 of {shown.length}. Search to narrow the list.</p>}
    </>
  );
}

// ---- Dialogs ----

function ApplicationDialog({ app, demo, onClose }: { app: Application | null; demo: boolean; onClose: () => void }) {
  const [form, setForm] = useState(() => ({
    role: app?.role ?? "",
    company: app?.company ?? "",
    jobUrl: app?.jobUrl ?? "",
    location: app?.location ?? "",
    stage: app?.stage ?? ("applied" as AppStage),
    applied: toDateInput(app?.appliedAt ?? (app ? null : Date.now())),
    source: app?.source ?? ("cold" as AppSource),
    resumeVersion: app?.resumeVersion ?? "",
    nextStep: app?.nextStep ?? "",
    followUp: toDateInput(app?.followUpAt ?? null),
    notes: app?.notes ?? "",
    jobType: (app?.jobType ?? "guess") as JobType | "guess",
  }));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.role.trim()) return setError("Add the role title.");
    const now = Date.now();
    const appliedAt = fromDateInput(form.applied);
    const version = form.resumeVersion.trim() || (await getProfile()).resumeVersion;
    const base = app ?? newApplication({ id: uid(), createdAt: appliedAt ?? now, role: form.role, company: null, stage: "saved", history: [{ stage: "saved", at: appliedAt ?? now }], demo });
    let next: Application = {
      ...base,
      role: form.role.trim().slice(0, 200),
      company: form.company.trim().slice(0, 200) || null,
      jobUrl: form.jobUrl.trim().slice(0, 2000) || null,
      location: form.location.trim().slice(0, 200) || null,
      source: form.source,
      resumeVersion: version.slice(0, 40),
      nextStep: form.nextStep.trim().slice(0, 300) || null,
      followUpAt: fromDateInput(form.followUp),
      notes: form.notes.slice(0, 5000),
      appliedAt: appliedAt ?? base.appliedAt,
      jobType: form.jobType === "guess" ? null : form.jobType,
    };
    next = moveApplication(next, form.stage, appliedAt ?? now);
    next = { ...next, ...(await afterStageChange(base, next, null)) };
    const parsed = newApplication(next);
    await db.applications.put(parsed);
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={app ? "Edit application" : "Add application"}
      description={app ? undefined : "For roles you applied to outside the chat. Paste the job post in the chat to also get a fit check."}
      footer={
        <>
          {app && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (!confirm(`Delete ${app.role}? Contacts linked to it are kept.`)) return;
                await db.transaction("rw", db.applications, db.contacts, async () => {
                  await db.applications.delete(app.id);
                  await db.contacts.where("applicationId").equals(app.id).modify({ applicationId: null });
                });
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Role" required value={form.role} onChange={(v) => set("role", v)} />
        <TextField label="Company" value={form.company} onChange={(v) => set("company", v)} />
        <Select label="Stage" value={form.stage} options={APP_STAGES.map((s) => [s, APP_STAGE_LABEL[s]] as const)} onChange={(v) => set("stage", v as AppStage)} />
        <Select label="How it started" value={form.source} options={APP_SOURCES.map((s) => [s, SOURCE_LABEL[s]] as const)} onChange={(v) => set("source", v as AppSource)} />
        <Select
          label="Job type"
          value={form.jobType}
          options={[["guess", `Guess from title (${JOB_TYPE_LABEL[jobTypeOf(form.role)]})`] as const, ...JOB_TYPES.map((t) => [t, JOB_TYPE_LABEL[t]] as const)]}
          onChange={(v) => set("jobType", v as JobType | "guess")}
        />
        <TextField label="Applied on" type="date" value={form.applied} onChange={(v) => set("applied", v)} />
        <TextField label="Resume version" placeholder="e.g. v2" value={form.resumeVersion} onChange={(v) => set("resumeVersion", v)} />
        <TextField label="Job post URL" type="url" value={form.jobUrl} onChange={(v) => set("jobUrl", v)} />
        <TextField label="Location" value={form.location} onChange={(v) => set("location", v)} />
        <TextField label="Next step" value={form.nextStep} onChange={(v) => set("nextStep", v)} />
        <TextField label="Follow up by" type="date" value={form.followUp} onChange={(v) => set("followUp", v)} />
        <TextField label="Notes" multiline className="sm:col-span-2" value={form.notes} onChange={(v) => set("notes", v)} />
        {error && <p className="text-[13px] text-danger sm:col-span-2" role="alert">{error}</p>}
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Dialog>
  );
}

function OutcomeDialog({ app, onClose }: { app: Application; onClose: () => void }) {
  const [o, setO] = useState<Omit<OutcomeLog, "at">>(() => ({
    result: app.outcome?.result ?? (app.stage === "offer" ? "offer" : app.stage === "withdrawn" ? "withdrawn" : app.stage === "rejected" ? "rejected" : "no_response"),
    reasonCategory: app.outcome?.reasonCategory ?? "none_given",
    reasonSource: app.outcome?.reasonSource ?? "none",
    notes: app.outcome?.notes ?? "",
    learning: app.outcome?.learning ?? "",
  }));
  async function save() {
    const fresh = (await db.applications.get(app.id)) ?? app;
    await db.applications.put(applyOutcome(fresh, { ...o, at: Date.now() }, Date.now()));
    await remember({
      demo: fresh.demo,
      kind: "outcome",
      applicationId: fresh.id,
      family: familyOf(fresh),
      title: `Outcome: ${fresh.role}${fresh.company ? ` at ${fresh.company}` : ""}, ${o.result.replace("_", " ")}`,
      detail: [o.notes && `What happened: ${o.notes}`, o.learning && `What I'd change: ${o.learning}`].filter(Boolean).join("\n"),
      refs: [...followedRefs(fresh.trace), ...followedRefs(fresh.cv?.rules)],
    });
    // Notes can become proposed skill rules; the user still accepts or dismisses each.
    if (o.notes.trim() || o.learning.trim()) void refreshNoteRules(fresh.demo).then(() => relearn(fresh.demo, "a logged outcome"));
    else void relearn(fresh.demo, "a logged outcome");
    onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log an outcome"
      description={`${app.role}${app.company ? ` · ${app.company}` : ""}`}
      footer={
        <>
          <Button onClick={onClose}>Skip</Button>
          <Button variant="primary" onClick={() => void save()}>Save outcome</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="What happened" value={o.result} options={OUTCOME_RESULTS.map((r) => [r, OUTCOME_LABEL[r]] as const)} onChange={(v) => setO({ ...o, result: v as OutcomeLog["result"] })} />
        <Select label="Reason" value={o.reasonCategory} options={REASON_CATEGORIES.map((r) => [r, REASON_LABEL[r]] as const)} onChange={(v) => setO({ ...o, reasonCategory: v as OutcomeLog["reasonCategory"] })} />
        <Select
          label="Where the reason came from"
          value={o.reasonSource}
          options={REASON_SOURCES.map((r) => [r, REASON_SOURCE_LABEL[r]] as const)}
          onChange={(v) => setO({ ...o, reasonSource: v as OutcomeLog["reasonSource"] })}
          className="sm:col-span-2"
        />
        <TextField label="Notes (what they said, which round)" multiline className="sm:col-span-2" value={o.notes} onChange={(v) => setO({ ...o, notes: v })} />
        <TextField label="What I'd change next time" multiline className="sm:col-span-2" value={o.learning} onChange={(v) => setO({ ...o, learning: v })} />
      </div>
      <p className="mt-3 text-[12.5px] text-ink-3">
        Reasons from a rejection email, a recruiter or interviewer feedback count as stated. Everything else, including the app&apos;s own analysis, is kept separate as a hypothesis.
      </p>
    </Dialog>
  );
}

function ContactDialog({ contact, apps, demo, onClose }: { contact: Contact | null; apps: Application[]; demo: boolean; onClose: () => void }) {
  const [form, setForm] = useState(() => ({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    title: contact?.title ?? "",
    company: contact?.company ?? "",
    recipientType: contact?.recipientType ?? ("alum" as RecipientType),
    stage: contact?.stage ?? ("not_contacted" as ContactStage),
    applicationId: contact?.applicationId ?? "",
    linkedinUrl: contact?.linkedinUrl ?? "",
    notes: contact?.notes ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.firstName.trim()) return setError("Add a first name.");
    const now = Date.now();
    const base = contact ?? newContact({ id: uid(), createdAt: now, firstName: form.firstName, recipientType: form.recipientType, stage: form.stage, history: [{ stage: form.stage, at: now }], source: "manual", demo });
    const stageChanged = contact && contact.stage !== form.stage;
    await db.contacts.put(
      newContact({
        ...base,
        firstName: form.firstName.trim().slice(0, 80),
        lastName: form.lastName.trim().slice(0, 80) || null,
        title: form.title.trim().slice(0, 200) || null,
        company: form.company.trim().slice(0, 200) || null,
        recipientType: form.recipientType,
        stage: form.stage,
        history: stageChanged ? [...base.history, { stage: form.stage, at: now }] : base.history,
        applicationId: form.applicationId || null,
        linkedinUrl: form.linkedinUrl.trim().slice(0, 500) || null,
        notes: form.notes.slice(0, 2000),
      }),
    );
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={contact ? "Edit contact" : "Add contact"}
      footer={
        <>
          {contact && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (!confirm(`Delete ${displayName(contact)}?`)) return;
                await db.contacts.delete(contact.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="First name" required value={form.firstName} onChange={(v) => set("firstName", v)} />
        <TextField label="Last name" value={form.lastName} onChange={(v) => set("lastName", v)} />
        <TextField label="Title" value={form.title} onChange={(v) => set("title", v)} />
        <TextField label="Company" value={form.company} onChange={(v) => set("company", v)} />
        <Select label="Relationship" value={form.recipientType} options={RECIPIENT_TYPES.map((r) => [r, RECIPIENT_LABELS[r]] as const)} onChange={(v) => set("recipientType", v as RecipientType)} />
        <Select label="Stage" value={form.stage} options={CONTACT_STAGES.map((s) => [s, CONTACT_STAGE_LABEL[s]] as const)} onChange={(v) => set("stage", v as ContactStage)} />
        <Select
          label="Linked application"
          value={form.applicationId}
          options={[["", "None"], ...apps.map((a) => [a.id, a.company ? `${a.role} · ${a.company}` : a.role] as const)]}
          onChange={(v) => set("applicationId", v)}
          className="sm:col-span-2"
        />
        <TextField label="LinkedIn URL" type="url" className="sm:col-span-2" value={form.linkedinUrl} onChange={(v) => set("linkedinUrl", v)} />
        <TextField label="Notes" multiline className="sm:col-span-2" value={form.notes} onChange={(v) => set("notes", v)} />
        {error && <p className="text-[13px] text-danger sm:col-span-2" role="alert">{error}</p>}
        <button type="submit" className="sr-only">Save</button>
      </form>
    </Dialog>
  );
}

function LinkedInImportDialog({ rows, existing, demo, onClose, onDone }: { rows: LinkedInConnection[]; existing: Contact[]; demo: boolean; onClose: () => void; onDone: (n: number) => void }) {
  const known = useMemo(() => new Set(existing.map((c) => connectionKey(c))), [existing]);
  const fresh = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = connectionKey(r);
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [rows, known]);
  const [busy, setBusy] = useState(false);

  async function confirmImport() {
    setBusy(true);
    const now = Date.now();
    const contacts = fresh.map((r) =>
      newContact({
        id: uid(),
        createdAt: now,
        firstName: r.firstName || null,
        lastName: r.lastName || null,
        title: r.position,
        company: r.company,
        recipientType: recipientTypeFromTitle(r.position),
        stage: "not_contacted",
        history: [{ stage: "not_contacted", at: now }],
        source: "linkedin_import",
        linkedinUrl: r.url,
        connectedOn: r.connectedOn,
        demo,
      }),
    );
    await db.contacts.bulkPut(contacts);
    onDone(contacts.length);
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Import from LinkedIn"
      description={`${rows.length} connections in the file · ${fresh.length} new · ${rows.length - fresh.length} already in your network`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!fresh.length || busy} onClick={() => void confirmImport()}>
            {busy ? "Importing…" : `Import ${fresh.length} contacts`}
          </Button>
        </>
      }
    >
      {fresh.length === 0 ? (
        <p className="text-[14px] text-ink-2">Everyone in this file is already in your network.</p>
      ) : (
        <div className="max-h-[50vh] overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[13px]">
            <caption className="sr-only">Connections to import</caption>
            <thead className="sticky top-0 bg-sunk text-[12px] text-ink-3">
              <tr>
                <th className="px-3 py-1.5 font-normal">Name</th>
                <th className="px-3 py-1.5 font-normal">Position</th>
                <th className="px-3 py-1.5 font-normal">Company</th>
              </tr>
            </thead>
            <tbody>
              {fresh.slice(0, 200).map((r) => (
                <tr key={connectionKey(r)} className="border-t border-line">
                  <td className="px-3 py-1.5">{`${r.firstName} ${r.lastName}`.trim()}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.position}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.company}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fresh.length > 200 && <p className="mt-2 text-[12.5px] text-ink-3">Previewing 200 of {fresh.length}.</p>}
      <p className="mt-3 text-[12.5px] text-ink-3">Nothing is imported until you confirm. Email addresses in the file are ignored, and nothing leaves this browser.</p>
    </Dialog>
  );
}
