"use client";
import { useEffect, useState } from "react";
import type { ArmSummary } from "@/server/store";
import { probBBeatsA, sampleSizePerArm, srmTest, twoProportionTest } from "@/lib/stats";
import { rate } from "@/lib/insights";
import { ArmBars, pct } from "@/components/charts";
import { H1, H2 } from "@/components/PageShell";

interface Results {
  experiment: string;
  persistence: "postgres" | "memory";
  arms: ArmSummary[];
}

/** Pre-registered before launch. Changing these after seeing data is not allowed. */
const PLAN = {
  baseline: 0.4,
  mde: 0.15,
  decision: 0.95,
};

export function ResultsView() {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/results", { cache: "no-store" });
        if (!res.ok) throw new Error(`Results are unavailable (${res.status}).`);
        const json = (await res.json()) as Results;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Results are unavailable.");
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const needed = sampleSizePerArm(PLAN.baseline, PLAN.mde);
  const a = data?.arms.find((x) => x.variant === "A");
  const b = data?.arms.find((x) => x.variant === "B");
  const ready = a && b && a.drafted > 0 && b.drafted > 0;
  const test = ready ? twoProportionTest({ conversions: a.copied, n: a.drafted }, { conversions: b.copied, n: b.drafted }) : null;
  const pB = ready ? probBBeatsA({ conversions: a.copied, n: a.drafted }, { conversions: b.copied, n: b.drafted }) : null;
  const srm = a && b && a.drafted + b.drafted > 0 ? srmTest(a.drafted, b.drafted) : null;
  const total = (a?.drafted ?? 0) + (b?.drafted ?? 0);

  return (
    <>
      <H1 lede="Every visitor who drafts a message is randomly assigned to one version. This page reads the live event log and recomputes everything on each refresh.">
        Template vs. AI draft: live results
      </H1>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[15px] font-medium">Pre-registered plan</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-[14.5px] sm:grid-cols-2">
          <Item term="Hypothesis">A draft grounded in the recipient&apos;s real profile gets copied (sent) more often than the user&apos;s own fill-in-the-blanks template.</Item>
          <Item term="Primary metric">Copy rate: users who copied a message ÷ users who received a draft.</Item>
          <Item term="Guardrails">Median seconds from draft to copy; how much people rewrite the draft before copying.</Item>
          <Item term="Assignment">50/50 by a hash of an anonymous ID, fixed per browser. No personal data is logged.</Item>
          <Item term="Sample size">{needed} users per arm to detect a 15-point lift from a 40% baseline (80% power, 5% two-sided).</Item>
          <Item term="Decision rule">Ship the AI draft if P(B beats A) ≥ {pct(PLAN.decision)} at the planned sample size and guardrails hold. No early calls.</Item>
        </dl>
      </section>

      {error && <p className="mt-6 text-[14px] text-danger" role="alert">{error}</p>}

      <H2>Where it stands</H2>
      {!data ? (
        <p className="text-[14px] text-ink-3">Loading…</p>
      ) : (
        <>
          <p className="max-w-[64ch] text-[15px] text-ink-2">
            {total === 0
              ? "No drafts yet. Results appear here as soon as people use the app."
              : `${total} users have received a draft. ${total < needed * 2 ? `That's ${pct(total / (needed * 2))} of the planned sample, so treat any difference as directional.` : "The planned sample size is reached."}`}
          </p>
          {a && b && total > 0 && (
            <div className="mt-5 rounded-2xl border border-line bg-surface p-5">
              <ArmBars
                arms={[
                  { label: "A · Template", r: rate("A", a.copied, a.drafted), color: "var(--series-a)" },
                  { label: "B · AI draft", r: rate("B", b.copied, b.drafted), color: "var(--series-b)" },
                ]}
              />
              <table className="mt-5 w-full text-left text-[14px]">
                <caption className="sr-only">Results by arm</caption>
                <thead className="text-[12.5px] text-ink-3">
                  <tr>
                    <th className="py-1 font-normal">Arm</th>
                    <th className="py-1 font-normal">Got a draft</th>
                    <th className="py-1 font-normal">Copied</th>
                    <th className="py-1 font-normal">Median seconds to copy</th>
                    <th className="py-1 font-normal">Average rewrite</th>
                  </tr>
                </thead>
                <tbody>
                  {[a, b].map((x) => (
                    <tr key={x.variant} className="border-t border-line">
                      <td className="py-2">{x.variant === "A" ? "A · Template" : "B · AI draft"}</td>
                      <td className="py-2">{x.drafted}</td>
                      <td className="py-2">{x.copied}</td>
                      <td className="py-2">{x.medianSecondsToCopy ?? "None yet"}</td>
                      <td className="py-2">{x.meanEditRatio === null ? "None yet" : pct(x.meanEditRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Difference (B − A)" value={test ? `${(test.diff * 100).toFixed(1)} pts` : "None yet"} sub={test ? `95% range ${(test.ciDiff.low * 100).toFixed(1)} to ${(test.ciDiff.high * 100).toFixed(1)} pts` : "Needs drafts in both arms"} />
            <Stat label="P(B beats A)" value={pB === null ? "None yet" : pct(pB)} sub={`Decision threshold ${pct(PLAN.decision)}`} />
            <Stat
              label="Split health"
              value={srm ? (srm.alarm ? "Check assignment" : "Healthy") : "None yet"}
              sub={srm ? `Sample-ratio check p = ${srm.pValue < 0.001 ? "< 0.001" : srm.pValue.toFixed(3)}` : "Checks the 50/50 split"}
            />
          </div>
          <p className="mt-6 text-[12.5px] text-ink-3">
            Storage: {data.persistence === "postgres" ? "Postgres (durable)" : "in-memory (local development only; resets on restart)"}. Visits with ?variant= in the URL, and demo-data sessions, are never counted.
          </p>
        </>
      )}
    </>
  );
}

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12.5px] text-ink-3">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none">{value}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-3">{sub}</p>
    </div>
  );
}
