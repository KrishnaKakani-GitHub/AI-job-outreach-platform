import Link from "next/link";
import { Mark } from "./icons";

const LINKS = [
  { href: "/", label: "App" },
  { href: "/results", label: "A/B results" },
  { href: "/lab", label: "Lab" },
  { href: "/case", label: "Case study" },
  { href: "/changelog", label: "Changelog" },
];

export function PageShell({ current, children }: { current: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Mark /> Warm Intro
          </Link>
          <nav aria-label="Pages" className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined} className={l.href === current ? "text-ink underline decoration-accent decoration-2 underline-offset-[6px]" : "text-ink-2 hover:text-ink"}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10">{children}</main>
    </div>
  );
}

export function H1({ children, lede }: { children: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[40px]">{children}</h1>
      {lede && <p className="mt-3 max-w-[64ch] text-[17px] leading-relaxed text-ink-2">{lede}</p>}
    </div>
  );
}

export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-3 mt-12 text-[22px] font-semibold tracking-tight">
      {children}
    </h2>
  );
}
