/**
 * Experiment statistics. Pure functions, no dependencies, unit-tested against
 * textbook values. Every number the UI or the AI shows comes from here.
 */

/** Abramowitz–Stegun 7.1.26 erf approximation (|error| < 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Inverse normal CDF (Acklam's algorithm, relative error < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("p must be in (0, 1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface Interval {
  low: number;
  high: number;
}

/** Wilson score interval for a binomial proportion. Safe at k = 0 and k = n. */
export function wilson(k: number, n: number, confidence = 0.95): Interval {
  if (n <= 0) return { low: 0, high: 1 };
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export interface ArmCounts {
  conversions: number;
  n: number;
}

export interface TwoPropResult {
  rateA: number;
  rateB: number;
  diff: number;
  ciDiff: Interval;
  z: number;
  pValue: number;
}

/** Two-sided two-proportion z-test (pooled SE for the test, unpooled for the CI). */
export function twoProportionTest(a: ArmCounts, b: ArmCounts, confidence = 0.95): TwoPropResult {
  if (a.n <= 0 || b.n <= 0) throw new RangeError("both arms need n > 0");
  const rateA = a.conversions / a.n;
  const rateB = b.conversions / b.n;
  const pooled = (a.conversions + b.conversions) / (a.n + b.n);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  const diff = rateB - rateA;
  const z = sePooled === 0 ? 0 : diff / sePooled;
  const pValue = sePooled === 0 ? 1 : 2 * (1 - normalCdf(Math.abs(z)));
  const se = Math.sqrt((rateA * (1 - rateA)) / a.n + (rateB * (1 - rateB)) / b.n);
  const zc = normalQuantile(1 - (1 - confidence) / 2);
  return { rateA, rateB, diff, ciDiff: { low: diff - zc * se, high: diff + zc * se }, z, pValue };
}

/**
 * Sample-ratio-mismatch check: chi-square goodness of fit (df = 1) against the
 * intended split. p < 0.001 is the conventional alarm threshold.
 */
export function srmTest(nA: number, nB: number, expectedShareA = 0.5): { chi2: number; pValue: number; alarm: boolean } {
  const total = nA + nB;
  if (total === 0) return { chi2: 0, pValue: 1, alarm: false };
  const eA = total * expectedShareA;
  const eB = total - eA;
  const chi2 = (nA - eA) ** 2 / eA + (nB - eB) ** 2 / eB;
  // For df = 1, P(X > chi2) = 2 * (1 - Phi(sqrt(chi2))).
  const pValue = 2 * (1 - normalCdf(Math.sqrt(chi2)));
  return { chi2, pValue, alarm: pValue < 0.001 };
}

/** Per-arm sample size for a two-sided two-proportion test. */
export function sampleSizePerArm(baseline: number, absoluteLift: number, alpha = 0.05, power = 0.8): number {
  const p1 = baseline;
  const p2 = baseline + absoluteLift;
  if (p1 <= 0 || p1 >= 1 || p2 <= 0 || p2 >= 1) throw new RangeError("rates must be in (0, 1)");
  const za = normalQuantile(1 - alpha / 2);
  const zb = normalQuantile(power);
  const pBar = (p1 + p2) / 2;
  const num = za * Math.sqrt(2 * pBar * (1 - pBar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / (absoluteLift * absoluteLift));
}

/** Seeded PRNG (mulberry32) so simulations and tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Marsaglia–Tsang gamma sampler (shape >= 1 branch plus boost for shape < 1). */
function gammaSample(shape: number, rng: () => number): number {
  if (shape < 1) return gammaSample(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaSample(a: number, b: number, rng: () => number): number {
  const x = gammaSample(a, rng);
  const y = gammaSample(b, rng);
  return x / (x + y);
}

/** P(rate_B > rate_A) under independent Beta(1,1) priors, by Monte Carlo. */
export function probBBeatsA(a: ArmCounts, b: ArmCounts, draws = 20000, seed = 7): number {
  const rng = mulberry32(seed);
  let wins = 0;
  for (let i = 0; i < draws; i++) {
    const ra = betaSample(1 + a.conversions, 1 + a.n - a.conversions, rng);
    const rb = betaSample(1 + b.conversions, 1 + b.n - b.conversions, rng);
    if (rb > ra) wins++;
  }
  return wins / draws;
}

function binomial(n: number, p: number, rng: () => number): number {
  // Normal approximation for large n keeps the in-browser lab fast.
  if (n > 200) {
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    return Math.max(0, Math.min(n, Math.round(mean + sd * gaussian(rng))));
  }
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}

export interface SimulationResult {
  experiments: number;
  significant: number;
  rate: number;
  interval: Interval;
}

/**
 * Run many simulated A/B tests with a known true effect. With lift = 0 the
 * significant share is the false-positive rate (should be about alpha);
 * with lift > 0 it is the empirical power.
 */
export function simulateExperiments(opts: {
  baseline: number;
  lift: number;
  nPerArm: number;
  experiments: number;
  alpha?: number;
  seed?: number;
}): SimulationResult {
  const { baseline, lift, nPerArm, experiments, alpha = 0.05, seed = 42 } = opts;
  const rng = mulberry32(seed);
  let significant = 0;
  for (let i = 0; i < experiments; i++) {
    const a = binomial(nPerArm, baseline, rng);
    const b = binomial(nPerArm, Math.min(0.999, baseline + lift), rng);
    if (twoProportionTest({ conversions: a, n: nPerArm }, { conversions: b, n: nPerArm }).pValue < alpha) significant++;
  }
  return { experiments, significant, rate: significant / experiments, interval: wilson(significant, experiments) };
}

/**
 * A/A test where the analyst peeks every `peekEvery` users per arm and stops at
 * the first p < alpha. Demonstrates false-positive inflation from peeking.
 */
export function simulatePeeking(opts: {
  baseline: number;
  nPerArm: number;
  peekEvery: number;
  experiments: number;
  alpha?: number;
  seed?: number;
}): SimulationResult {
  const { baseline, nPerArm, peekEvery, experiments, alpha = 0.05, seed = 99 } = opts;
  const rng = mulberry32(seed);
  let significant = 0;
  for (let i = 0; i < experiments; i++) {
    let a = 0;
    let b = 0;
    for (let n = 1; n <= nPerArm; n++) {
      if (rng() < baseline) a++;
      if (rng() < baseline) b++;
      if (n % peekEvery === 0 && twoProportionTest({ conversions: a, n }, { conversions: b, n }).pValue < alpha) {
        significant++;
        break;
      }
    }
  }
  return { experiments, significant, rate: significant / experiments, interval: wilson(significant, experiments) };
}

/** Minimum per-group count below which a rate is shown as "too few to tell". */
export const MIN_GROUP_N = 5;

/** Analytic power of a two-sided two-proportion z-test with n users per arm. */
export function powerTwoProportion(baseline: number, absoluteLift: number, nPerArm: number, alpha = 0.05): number {
  const p1 = baseline;
  const p2 = Math.min(0.999, Math.max(0.001, baseline + absoluteLift));
  if (nPerArm <= 0 || absoluteLift === 0) return alpha;
  const za = normalQuantile(1 - alpha / 2);
  const pBar = (p1 + p2) / 2;
  const se0 = Math.sqrt((2 * pBar * (1 - pBar)) / nPerArm);
  const se1 = Math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / nPerArm);
  const d = Math.abs(p2 - p1);
  return normalCdf((d - za * se0) / se1) + normalCdf((-d - za * se0) / se1);
}
