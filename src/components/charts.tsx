"use client";
/**
 * Hand-built SVG/HTML charts. Single-series charts use one colour; every rate
 * shows its interval and count; tooltips use native titles plus visible labels
 * so nothing depends on colour or hover alone.
 */
import { useId, useState } from "react";
import type { Rate } from "@/lib/insights";

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Horizontal bar for a rate with its 95% interval as a whisker. */
export function RateRow({ r, label, color = "var(--series-b)" }: { r: Rate; label?: string; color?: string }) {
  const tip = `${label ?? r.key}: ${pct(r.rate)} (${r.k} of ${r.n}), 95% interval ${pct(r.ci.low)}–${pct(r.ci.high)}${r.enough ? "" : ". Early signal: fewer than 5 data points"}`;
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 py-1.5" title={tip}>
      <span className="truncate text-[13px] text-ink-2">{label ?? r.key}</span>
      <div className="relative h-3" role="img" aria-label={tip}>
        <div className="absolute inset-y-[5px] left-0 right-0 rounded-full bg-grid" />
        <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${Math.max(r.rate * 100, 0.8)}%`, background: color, opacity: r.enough ? 1 : 0.45 }} />
        <div className="absolute top-1/2 h-px bg-ink" style={{ left: `${r.ci.low * 100}%`, width: `${(r.ci.high - r.ci.low) * 100}%` }} />
        <div className="absolute top-[1px] h-[10px] w-px bg-ink" style={{ left: `${r.ci.low * 100}%` }} />
        <div className="absolute top-[1px] h-[10px] w-px bg-ink" style={{ left: `${r.ci.high * 100}%` }} />
      </div>
      <span className="w-[7.5rem] text-right text-[13px] tabular-nums text-ink">
        {pct(r.rate)}
        <span className="ml-1 text-ink-3">{r.k}/{r.n}</span>
        {!r.enough && <span className="ml-1 text-[11px] text-warn">early</span>}
      </span>
    </div>
  );
}

/** Fit score as a ring. The number is the hero; the ring is secondary. */
export function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Fit score ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums">{score}</span>
    </div>
  );
}

/** Single-series line with a hover crosshair and value tooltip. */
export function LineChart({
  points,
  yMax,
  yLabel,
  format = (v: number) => String(Math.round(v)),
  height = 140,
}: {
  points: { x: string; y: number; note?: string }[];
  yMax: number;
  yLabel: string;
  format?: (v: number) => string;
  height?: number;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const w = 560;
  const pad = { l: 34, r: 12, t: 10, b: 22 };
  if (points.length === 0) return <p className="text-sm text-ink-3">No data yet.</p>;
  const xs = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (w - pad.l - pad.r));
  const ys = (v: number) => pad.t + (1 - v / yMax) * (height - pad.t - pad.b);
  const ticks = [0, yMax / 2, yMax];
  const d = points.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onMouseLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{`${yLabel}: ${points.map((p) => `${p.x} ${format(p.y)}`).join(", ")}`}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={ys(t)} y2={ys(t)} stroke="var(--grid)" />
            <text x={pad.l - 6} y={ys(t) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">{format(t)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--series-b)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.x}>
            <circle cx={xs(i)} cy={ys(p.y)} r={hover === i ? 5 : 3.5} fill="var(--series-b)" stroke="var(--surface)" strokeWidth="2" />
            <rect x={xs(i) - 14} y={pad.t} width={28} height={height - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} role="img" aria-label={`${p.x}: ${format(p.y)}`} />
          </g>
        ))}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--ink-3)" strokeDasharray="3 3" />}
        <text x={pad.l} y={height - 6} fontSize="10" fill="var(--ink-3)">{points[0].x}</text>
        {points.length > 1 && <text x={w - pad.r} y={height - 6} fontSize="10" textAnchor="end" fill="var(--ink-3)">{points[points.length - 1].x}</text>}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2 py-1 text-xs shadow-sm" style={{ left: `${(xs(hover) / w) * 100}%`, transform: "translateX(-50%)" }}>
          <div className="font-medium tabular-nums">{format(points[hover].y)}</div>
          <div className="text-ink-3">{points[hover].x}{points[hover].note ? ` · ${points[hover].note}` : ""}</div>
        </div>
      )}
    </div>
  );
}

/** Two-arm comparison bars (A = template, B = AI draft), always directly labelled. */
export function ArmBars({ arms }: { arms: { label: string; r: Rate; color: string }[] }) {
  return (
    <div className="space-y-1">
      {arms.map((a) => (
        <RateRow key={a.label} r={a.r} label={a.label} color={a.color} />
      ))}
    </div>
  );
}
