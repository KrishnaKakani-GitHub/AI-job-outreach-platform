"use client";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import ReactMarkdown from "react-markdown";
import type { DocKind } from "@/lib/schemas";
import { buildDemoData } from "@/lib/demo";
import { memoryFromRecords } from "@/lib/memory";
import { familyOf } from "@/lib/insights";
import { RULE_BY_ID } from "@/lib/skills/catalog";
import { BACKGROUND, JOB, RECIPIENT, RESUME } from "@/lib/samples";
import { tierProgress, TIER_LABEL, TIER_PATTERN, TIER_PERSONAL } from "@/lib/learn";
import { db, type ChatMessage } from "@/client/db";
import { handleInput, isPaste, reclassify, runDraft, runStrategy, runTailor, type CraftPayload, type DraftPayload, type DraftRequest, type FitPayload, type InterviewPayload, type PastePayload, type SimilarPayload, type Status, type StrategyPayload, type TailorPayload } from "@/client/assistant";
import { prefs } from "@/client/session";
import { uid } from "@/lib/text";
import { DraftCard } from "./DraftCard";
import { CraftCard } from "./CraftCard";
import { Switch } from "./ui";
import { FitCard, PasteBubble, ProfileNotice, SimilarCard, StrategyCard } from "./Cards";
import { InsightsPanel, ProfilePanel } from "./Panels";
import { TrackerPanel } from "./Tracker";
import { SkillsPanel } from "./SkillsPanel";
import { InterviewCard, TailorCard } from "./SkillCards";
import { IconBoard, IconBriefcase, IconChart, IconCompass, IconDoc, IconMail, IconMenu, IconMoon, IconPlus, IconSend, IconSpark, IconStop, IconSun, IconUser, Mark } from "./icons";

type Panel = "tracker" | "insights" | "profile" | "skills" | null;

export default function WarmIntroApp() {
  const [chatId, setChatId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [status, setStatus] = useState<Status>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(() => prefs.get("wi-demo") === "1");
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    const t = prefs.get("wi-theme");
    return t === "light" || t === "dark" ? t : null;
  });
  const [navOpen, setNavOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const chats = useLiveQuery(() => db.chats.orderBy("updatedAt").reverse().toArray(), []) ?? [];
  const messages = useLiveQuery(() => (chatId ? db.messages.where("chatId").equals(chatId).sortBy("createdAt") : Promise.resolve([] as ChatMessage[])), [chatId]) ?? [];
  const myApps = useLiveQuery(() => db.applications.filter((a) => a.demo === demo).toArray(), [demo]) ?? [];
  const [mountedAt] = useState(() => Date.now());
  const learned = tierProgress(myApps, mountedAt);
  const nextAt = learned.tier === "job_post" ? TIER_PERSONAL : learned.tier === "early" ? TIER_PATTERN : null;
  const profile = useLiveQuery(() => db.profile.get("me"));

  const busy = status !== null;

  const ensureChat = useCallback(async (): Promise<string> => {
    if (chatId) return chatId;
    const id = uid();
    await db.chats.put({ id, title: "New chat", createdAt: Date.now(), updatedAt: Date.now(), applicationId: null });
    setChatId(id);
    return id;
  }, [chatId]);

  const run = useCallback(
    async (fn: (ctx: { chatId: string; setStatus: (s: Status) => void; signal: AbortSignal }) => Promise<void>) => {
      setError(null);
      const id = await ensureChat();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await fn({ chatId: id, setStatus, signal: ac.signal });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setStatus(null);
        abortRef.current = null;
      }
    },
    [ensureChat],
  );

  const send = useCallback((text: string, kind?: DocKind) => run((ctx) => handleInput(text, ctx, kind)), [run]);

  function newChat() {
    setChatId(null);
    setNavOpen(false);
    setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function toggleDemo() {
    const next = !demo;
    setDemo(next);
    prefs.set("wi-demo", next ? "1" : "0");
    if (next) {
      const { applications, contacts } = buildDemoData();
      await db.applications.bulkPut(applications);
      await db.contacts.bulkPut(contacts);
      await db.memory.bulkPut(memoryFromRecords(applications, familyOf, (id) => RULE_BY_ID.get(id)?.text ?? id));
    } else {
      await db.applications.filter((a) => a.demo).delete();
      await db.contacts.filter((c) => c.demo).delete();
      await db.memory.filter((m) => m.demo).delete();
    }
  }

  function toggleTheme() {
    const current = theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    prefs.set("wi-theme", next);
  }

  async function tryExample() {
    await run(async (ctx) => {
      await handleInput(RESUME, ctx, "resume");
      await handleInput(BACKGROUND, ctx, "background");
      await handleInput(JOB, ctx, "job_description");
      await handleInput(RECIPIENT, ctx, "recipient_profile");
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newChat();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        composerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const greeting = profile?.name ? `Hi ${profile.name.split(" ")[0]}.` : "Find your way in.";

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar */}
      <nav
        className={`${navOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-line bg-sunk transition-transform md:static md:translate-x-0`}
        aria-label="Conversations"
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <Mark />
          <span className="text-[16px] font-semibold tracking-tight">AI Job Tracker</span>
        </div>
        <div className="px-3 py-2">
          <button type="button" onClick={newChat} className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[14px] hover:border-ink-3">
            <IconPlus /> New chat <kbd className="ml-auto text-[11px] text-ink-3">⌘K</kbd>
          </button>
        </div>
        <p className="px-4 pb-1 pt-3 text-[12px] text-ink-3">Applications</p>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {chats.length === 0 && <li className="px-2 py-1.5 text-[13px] text-ink-3">Each job you paste gets its own chat.</li>}
          {chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setChatId(c.id);
                  setNavOpen(false);
                }}
                aria-current={c.id === chatId ? "page" : undefined}
                className={`w-full truncate rounded-lg px-3 py-1.5 text-left text-[14px] ${c.id === chatId ? "bg-surface font-medium" : "text-ink-2 hover:bg-surface/60"}`}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-line px-3 py-3 text-[14px]">
          <button type="button" onClick={() => setPanel("insights")} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface/60">
            <span className="flex items-center gap-2"><IconChart /> Insights</span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-grid" aria-hidden>
              <span className="block h-full bg-accent" style={{ width: `${nextAt ? Math.min(1, learned.resolved / nextAt) * 100 : 100}%` }} />
            </span>
            <span className="text-[11.5px] text-ink-3">
              {TIER_LABEL[learned.tier]}
              {nextAt ? ` · ${learned.resolved} of ${nextAt} outcomes` : ""}
            </span>
          </button>
          <button type="button" onClick={() => setPanel("tracker")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface/60"><IconBoard /> Tracker</button>
          <button type="button" onClick={() => setPanel("skills")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface/60"><IconSpark /> Skills</button>
          <button type="button" onClick={() => setPanel("profile")} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface/60"><IconUser /> Profile</button>
          <Switch label="Demo data" checked={demo} onChange={() => void toggleDemo()} className="w-full rounded-lg px-2 py-1.5 text-[13px] text-ink-2 hover:bg-surface/60" />
          <div className="flex items-center gap-3 px-2 pt-1 text-[12.5px] text-ink-3">
            <Link href="/results" className="hover:text-ink">A/B results</Link>
            <Link href="/case" className="hover:text-ink">Case study</Link>
            <Link href="/lab" className="hover:text-ink">Lab</Link>
          </div>
        </div>
      </nav>
      {navOpen && <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-3 py-2.5 md:px-5">
          <button type="button" className="rounded-lg p-2 hover:bg-sunk md:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu"><IconMenu /></button>
          <p className="truncate text-[14px] text-ink-2">{chats.find((c) => c.id === chatId)?.title ?? ""}</p>
          {demo && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[12px] text-warn">Demo data on</span>}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setPanel("tracker")} className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-sunk sm:flex"><IconBoard width={16} height={16} /> Tracker</button>
            <button type="button" onClick={() => setPanel("insights")} className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink-2 hover:bg-sunk sm:flex"><IconChart width={16} height={16} /> Insights</button>
            <button type="button" onClick={toggleTheme} className="rounded-lg p-2 text-ink-2 hover:bg-sunk" aria-label="Switch light or dark theme">
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </header>

        <Thread
          messages={messages}
          status={status}
          busy={busy}
          error={error}
          greeting={greeting}
          onStarter={(hint) => {
            composerRef.current?.focus();
            if (composerRef.current) composerRef.current.placeholder = hint;
          }}
          onExample={tryExample}
          onReclassify={(id, k) => run((ctx) => reclassify(id, k, ctx))}
          onRedraft={(id, p, r) => run((ctx) => runDraft({ ...r, recipientText: p.recipientText, replaceMessageId: id }, ctx))}
          onStrategy={() => run((ctx) => runStrategy(ctx))}
          onOpenProfile={() => setPanel("profile")}
          onTailor={(appId) => run((ctx) => runTailor(ctx, appId))}
        />

        <Composer ref={composerRef} busy={busy} onSend={send} onStop={() => abortRef.current?.abort()} />
      </main>

      {panel === "tracker" && <TrackerPanel demo={demo} chatId={chatId} onClose={() => setPanel(null)} />}
      {panel === "insights" && <InsightsPanel demo={demo} onClose={() => setPanel(null)} />}
      {panel === "profile" && <ProfilePanel onClose={() => setPanel(null)} />}
      {panel === "skills" && <SkillsPanel demo={demo} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Thread(props: {
  messages: ChatMessage[];
  status: Status;
  busy: boolean;
  error: string | null;
  greeting: string;
  onStarter: (hint: string) => void;
  onExample: () => void;
  onReclassify: (id: string, k: DocKind) => void;
  onRedraft: (id: string, p: DraftPayload, r: Omit<DraftRequest, "recipientText" | "replaceMessageId">) => void;
  onStrategy: () => void;
  onOpenProfile: () => void;
  onTailor: (applicationId: string) => void;
}) {
  const { messages, status, busy, error } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastLen = messages.length + (messages[messages.length - 1]?.text?.length ?? 0);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    // Wait a frame so newly mounted cards have their final height.
    const raf = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }));
    return () => cancelAnimationFrame(raf);
  }, [lastLen, status]);

  if (messages.length === 0 && !status) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-8">
        <h1 className="text-center text-[34px] font-semibold leading-tight tracking-tight sm:text-[44px]">{props.greeting}</h1>
        <p className="mt-3 max-w-[46ch] text-center text-[16px] text-ink-2">
          Paste a job post and the profile of someone at the company. You get a fit check and a short note that only says true things about you both.
        </p>
        <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
          <Starter icon={<IconDoc />} title="Add my resume" body="Saved once, used for every check." onClick={() => props.onStarter("Paste your resume…")} />
          <Starter icon={<IconBriefcase />} title="Check my fit" body="Paste a job description." onClick={() => props.onStarter("Paste a job description…")} />
          <Starter icon={<IconMail />} title="Draft an intro" body="Paste someone's LinkedIn profile." onClick={() => props.onStarter("Paste their LinkedIn profile…")} />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13.5px]">
          <button type="button" onClick={props.onExample} className="text-ink underline decoration-accent decoration-2 underline-offset-4 hover:decoration-4">
            Try it with a sample resume, job post and profile
          </button>
          <button type="button" onClick={props.onStrategy} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
            <IconCompass width={15} height={15} /> What should I do next?
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) stick.current = true;
      }}
      // Only a deliberate upward scroll by the person stops auto-follow.
      onWheel={(e) => {
        if (e.deltaY < 0) stick.current = false;
      }}
      onTouchMove={() => {
        stick.current = false;
      }}
    >
      <ol className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-6 pt-4 md:px-6" aria-live="polite">
        {messages.map((m) => (
          <li key={m.id}>
            <MessageView {...props} m={m} busy={busy} />
          </li>
        ))}
        {status && (
          <li className="flex items-center gap-2.5 text-[14px] text-ink-2" role="status">
            <Mark size={18} />
            <span className="thinking inline-flex gap-0.5" aria-hidden><span>•</span><span>•</span><span>•</span></span>
            {status.label}
          </li>
        )}
        {error && (
          <li className="rounded-xl border border-danger/40 px-4 py-3 text-[14px] text-danger" role="alert">
            {error}
          </li>
        )}
      </ol>
    </div>
  );
}

function MessageView({ m, busy, ...p }: { m: ChatMessage; busy: boolean } & Parameters<typeof Thread>[0]) {
  if (m.role === "user") {
    if (m.kind === "paste") return <PasteBubble text={m.text ?? ""} p={m.payload as PastePayload} disabled={busy} onReclassify={(k) => p.onReclassify(m.id, k)} />;
    return <div className="ml-auto w-fit max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-sunk px-3.5 py-2.5 text-[15px]">{m.text}</div>;
  }
  const body = (() => {
    switch (m.kind) {
      case "fit":
        return <FitCard p={m.payload as FitPayload} />;
      case "craft":
        return <CraftCard p={m.payload as CraftPayload} busy={busy} onTailor={() => p.onTailor((m.payload as CraftPayload).applicationId)} />;
      case "draft":
        return <DraftCard messageId={m.id} p={m.payload as DraftPayload} busy={busy} onRedraft={(r) => p.onRedraft(m.id, m.payload as DraftPayload, r)} />;
      case "strategy":
        return <StrategyCard p={m.payload as StrategyPayload} />;
      case "similar":
        return <SimilarCard messageId={m.id} p={m.payload as SimilarPayload} />;
      case "tailor":
        return <TailorCard messageId={m.id} p={m.payload as TailorPayload} />;
      case "interview":
        return <InterviewCard p={m.payload as InterviewPayload} />;
      case "profile":
        return <ProfileNotice what={(m.payload as { what: "resume" | "background" }).what} onOpenProfile={p.onOpenProfile} />;
      default:
        return m.text ? <div className="prose-chat text-[15.5px] leading-relaxed"><ReactMarkdown>{m.text}</ReactMarkdown></div> : null;
    }
  })();
  return (
    <div className="flex gap-3">
      <div className="mt-1 shrink-0"><Mark size={20} /></div>
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}

function Starter({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-line bg-surface p-3.5 text-left hover:border-ink-3">
      <span className="text-ink-2">{icon}</span>
      <span className="mt-2 block text-[14.5px] font-medium">{title}</span>
      <span className="block text-[13px] text-ink-3">{body}</span>
    </button>
  );
}


const Composer = forwardRef<HTMLTextAreaElement, { busy: boolean; onSend: (text: string, kind?: DocKind) => Promise<void>; onStop: () => void }>(function Composer({ busy, onSend, onStop }, ref) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<{ id: string; text: string }[]>([]);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  async function submit() {
    if (busy) return;
    const items = [...attachments.map((a) => a.text), value.trim()].filter(Boolean);
    if (!items.length) return;
    setAttachments([]);
    setValue("");
    for (const t of items) await onSend(t);
  }

  return (
    <div className="px-3 pb-3 md:px-6 md:pb-5">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-surface p-2 shadow-[0_1px_0_rgba(0,0,0,0.02)] focus-within:border-ink-3">
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-1 pb-2">
            {attachments.map((a) => (
              <li key={a.id} className="inline-flex items-center gap-2 rounded-lg bg-sunk px-2.5 py-1.5 text-[13px]">
                <IconDoc width={15} height={15} />
                <span className="max-w-[14rem] truncate">{a.text.split("\n").find((l) => l.trim())}</span>
                <span className="text-ink-3">{a.text.length.toLocaleString()} chars</span>
                <button type="button" aria-label="Remove pasted text" className="text-ink-3 hover:text-ink" onClick={() => setAttachments((xs) => xs.filter((x) => x.id !== a.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message</span>
            <textarea
              ref={(el) => {
                inner.current = el;
                if (typeof ref === "function") ref(el);
                else if (ref) ref.current = el;
              }}
              rows={1}
              value={value}
              placeholder="Paste a resume, job post, or someone's profile…"
              className="block max-h-[220px] w-full resize-none bg-transparent px-2 py-2 text-[15.5px] outline-none placeholder:text-ink-3"
              onChange={(e) => setValue(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (isPaste(text)) {
                  e.preventDefault();
                  setAttachments((xs) => [...xs, { id: uid(), text }]);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </label>
          {busy ? (
            <button type="button" onClick={onStop} className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-paper" aria-label="Stop">
              <IconStop />
            </button>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={!value.trim() && !attachments.length} className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-ink disabled:opacity-35" aria-label="Send">
              <IconSend />
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11.5px] text-ink-3">Your documents stay in this browser. Drafts can be wrong; read before you send.</p>
    </div>
  );
});
