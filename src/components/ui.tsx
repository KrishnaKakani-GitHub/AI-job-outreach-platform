"use client";
/**
 * Small, accessible UI primitives used across the app: a styled native
 * select (keeps keyboard and screen-reader behavior), a switch, a modal
 * dialog built on <dialog>, and labelled form fields.
 */
import { useEffect, useId, useRef } from "react";
import { IconClose } from "./icons";

export function Select({
  label,
  value,
  options,
  onChange,
  size = "md",
  hideLabel = false,
  disabled,
  title,
  className = "",
  badge,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
  size?: "sm" | "md";
  hideLabel?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  badge?: React.ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className={hideLabel ? "sr-only" : "flex items-center gap-1.5 text-[12px] text-ink-3"}>
        {label}
        {!hideLabel && badge}
      </span>
      <select
        className={`select w-full ${size === "sm" ? "select-sm" : "text-[14px]"}`}
        value={value}
        disabled={disabled}
        title={title}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Switch({ checked, onChange, label, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-3 ${className}`}
    >
      <span>{label}</span>
      <span className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`} aria-hidden>
        <span className={`absolute h-[16px] w-[16px] rounded-full bg-surface shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
      </span>
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      style={wide ? { width: "min(46rem, calc(100vw - 24px))" } : undefined}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-34px)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 id={`${id}-t`} className="text-[17px] font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-sunk" aria-label={`Close ${title}`}>
              <IconClose />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  multiline,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "url" | "date";
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <label className={`block text-[12.5px] text-ink-2 ${className}`}>
      {label}
      {required && <span className="text-danger"> *</span>}
      {multiline ? (
        <textarea className="input mt-1 min-h-20 text-[14px]" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input mt-1 text-[14px]" type={type} value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

const BUTTON = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-line bg-surface text-ink hover:bg-sunk",
  ghost: "text-ink-2 hover:bg-sunk hover:text-ink",
  danger: "text-danger hover:bg-sunk",
};

export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors disabled:opacity-50 ${BUTTON[variant]} ${className}`}
    />
  );
}

/** Small evidence-strength label used on every learned suggestion. */
export function EvidenceBadge({ tier }: { tier: "job_post" | "notes" | "early" | "pattern" | "strong" }) {
  const map = {
    job_post: { label: "Based on this job post", cls: "bg-sunk text-ink-2" },
    notes: { label: "From your notes", cls: "border border-line text-ink-2" },
    early: { label: "Early signal", cls: "bg-warn-soft text-warn" },
    pattern: { label: "Pattern", cls: "bg-accent-soft text-ink" },
    strong: { label: "Strong pattern", cls: "bg-accent text-accent-ink" },
  }[tier];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${map.cls}`}>{map.label}</span>;
}

/** Date helpers for <input type="date"> (local calendar day). */
export function toDateInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromDateInput(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}
export function shortDate(ts: number | null): string {
  return ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
