"use client";
import { useMemo, useState } from "react";
import { powerTwoProportion, sampleSizePerArm, simulateExperiments, simulatePeeking, srmTest, type SimulationResult } from "@/lib/stats";
import { LineChart, pct } from "@/components/charts";
import { H1, H2 } from "@/components/PageShell";

export function LabView() {
  const [baseline, setBaseline] = useState(0.4);
  const [lift, setLift] = useState(0.1);
  const [n, setN] = useState(200);
  const [aa, setAa] = useState<SimulationResult | null>(null);
  const [ab, setAb] = useState<SimulationResult | null>(null);
  const [peek, setPeek] = useState<SimulationResult | null>(null);
  const [skew, setSkew] = useState(0.5);
  const [seed, setSeed] = useState(1);

  const curve = useMemo(() => {
    const ns = [25, 50, 100, 150, 200, 300, 400, 600, 800, 1200];
    return ns.map((x) => ({ x: `${x}`, y: powerTwoProportion(baseline, lift, x) }));
  }, [baseline, lift]);
  const needed = lift > 0 && baseline + lift < 1 ? sampleSizePerArm(baseline, lift) : null;
  const srm = srmTest(Math.round(1000 * skew), Math.round(1000 * (1 - skew)));

  function run() {
    const s = seed + 1;
    setSeed(s);
    setAa(simulateExperiments({ baseline, lift: 0, nPerArm: n, experiments: 1500, seed: s }));
    setAb(simulateExperiments({ baseline, lift, nPerArm: n, experiments: 1500, seed: s + 1000 }));
    setPeek(simulatePeeking({ baseline, nPerArm: n, peekEvery: Math.max(10, Math.round(n / 20)), experiments: 800, seed: s + 2000 }));
  }

  return (
    <>
      <H1 lede="Before trusting a live result, check the method on data where the right answer is known. Set a true effect, simulate thousands of experiments in your browser, and see how often the test gets it right.">
        Experiment lab
      </H1>

      <section className="grid gap-5 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-3">
        <Slider label="Baseline copy rate" value={baseline} min={0.05} max={0.8} step={0.01} format={pct} onChange={setBaseline} />
        <Slider label="True lift (absolute)" value={lift} min={0} max={0.2} step={0.01} format={(v) => `${(v * 100).toFixed(0)} pts`} onChange={setLift} />
        <Slider label="Users per arm" value={n} min={20} max={1500} step={10} format={(v) => String(v)} onChange={setN} />
        <div className="sm:col-span-3">
          <button type="button" onClick={run} className="rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink">
            Run 1,500 simulated experiments
          </button>
          <span className="ml-3 text-[13px] text-ink-3">Seeded, so results are reproducible.</span>
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Result
          title="False alarms (A/A)"
          r={aa}
          explain="No real difference is planted. A sound test calls a winner about 5% of the time."
        />
        <Result title="Power (A/B)" r={ab} explain={`A ${(lift * 100).toFixed(0)}-point lift is planted. This is how often the test detects it at ${n} users per arm.`} />
        <Result title="False alarms with peeking" r={peek} explain="Same A/A test, but checking 20 times and stopping at the first p < 0.05. This is why the plan forbids early calls." />
      </div>

      <H2>Power by sample size</H2>
      <p className="mb-3 max-w-[64ch] text-[15px] text-ink-2">
        Chance of detecting a {(lift * 100).toFixed(0)}-point lift from a {pct(baseline)} baseline.
        {needed ? ` 80% power needs ${needed.toLocaleString()} users per arm.` : " Set a lift above zero to see the required sample."}
      </p>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <LineChart points={curve} yMax={1} yLabel="Power by users per arm" format={(v) => pct(v)} />
        <p className="mt-1 text-[12px] text-ink-3">Horizontal axis: users per arm, from 25 to 1,200.</p>
      </div>

      <H2>Why the primary metric is “copied,” not “replied”</H2>
      <p className="max-w-[64ch] text-[15px] text-ink-2">
        Public cold-outreach benchmarks put reply rates around 2.6%. Detecting a 50% relative lift in replies (2.6% to 3.9%) needs{" "}
        <strong className="text-ink">{sampleSizePerArm(0.026, 0.013).toLocaleString()} messages per arm</strong>. One job seeker sends a few dozen. Copying the draft happens in seconds and far more often, so it is the leading
        metric this test can actually measure; reply rate is the follow-up test once many users pool their outcomes.
      </p>

      <H2>Sabotage the split</H2>
      <p className="mb-3 max-w-[64ch] text-[15px] text-ink-2">
        If assignment is broken (a redirect drops some users, or a bot hits one arm), the arms stop being comparable. Skew a 1,000-user split and watch the sample-ratio check react.
      </p>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <Slider label="Share sent to A" value={skew} min={0.4} max={0.6} step={0.005} format={pct} onChange={setSkew} />
        <p className={`mt-3 text-[15px] ${srm.alarm ? "text-danger" : "text-ink"}`} role="status">
          {Math.round(1000 * skew)} vs {Math.round(1000 * (1 - skew))}: p = {srm.pValue < 0.001 ? "< 0.001" : srm.pValue.toFixed(3)}. {srm.alarm ? "Alarm: don't read the results until assignment is fixed." : "Within normal variation."}
        </p>
      </div>
    </>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block text-[13px] text-ink-2">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-ink">{format(value)}</span>
      </span>
      <input type="range" className="mt-2 w-full accent-[var(--accent)]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Result({ title, r, explain }: { title: string; r: SimulationResult | null; explain: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[12.5px] text-ink-3">{title}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none">{r ? pct(r.rate, 1) : "Not run"}</p>
      {r && <p className="mt-1 text-[12px] tabular-nums text-ink-3">95% range {pct(r.interval.low, 1)}–{pct(r.interval.high, 1)}, {r.significant} of {r.experiments}</p>}
      <p className="mt-2 text-[13px] text-ink-2">{explain}</p>
    </div>
  );
}
