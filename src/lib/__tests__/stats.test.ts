import { describe, expect, it } from "vitest";
import {
  normalCdf,
  powerTwoProportion,
  normalQuantile,
  probBBeatsA,
  sampleSizePerArm,
  simulateExperiments,
  simulatePeeking,
  srmTest,
  twoProportionTest,
  wilson,
} from "../stats";

describe("normal distribution", () => {
  it("matches textbook values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.8)).toBeCloseTo(0.841621, 5);
  });
});

describe("wilson", () => {
  it("matches a known interval (k=5, n=10)", () => {
    const ci = wilson(5, 10);
    expect(ci.low).toBeCloseTo(0.2366, 3);
    expect(ci.high).toBeCloseTo(0.7634, 3);
  });
  it("stays inside [0,1] at the edges", () => {
    expect(wilson(0, 4).low).toBe(0);
    expect(wilson(4, 4).high).toBeLessThanOrEqual(1);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("twoProportionTest", () => {
  it("reproduces the Cookie Cats 7-day retention test", () => {
    // gate_30: 8502/44700, gate_40: 8279/45489 → p ≈ 0.0016
    const r = twoProportionTest({ conversions: 8502, n: 44700 }, { conversions: 8279, n: 45489 });
    expect(r.diff).toBeCloseTo(-0.0082, 3);
    expect(r.pValue).toBeCloseTo(0.0016, 3);
  });
  it("returns p = 1 for identical arms", () => {
    expect(twoProportionTest({ conversions: 10, n: 100 }, { conversions: 10, n: 100 }).pValue).toBeCloseTo(1, 6);
  });
  it("rejects empty arms", () => {
    expect(() => twoProportionTest({ conversions: 0, n: 0 }, { conversions: 1, n: 2 })).toThrow();
  });
});

describe("srmTest", () => {
  it("flags the Cookie Cats split", () => {
    const r = srmTest(44700, 45489);
    expect(r.pValue).toBeCloseTo(0.0086, 3);
  });
  it("does not alarm on a clean split", () => {
    expect(srmTest(500, 510).alarm).toBe(false);
  });
});

describe("sampleSizePerArm", () => {
  it("matches the standard formula for 40% → 55%", () => {
    expect(sampleSizePerArm(0.4, 0.15)).toBeGreaterThanOrEqual(170);
    expect(sampleSizePerArm(0.4, 0.15)).toBeLessThanOrEqual(175);
  });
  it("shows why reply rate is a slow metric (2.6% baseline, +50% relative)", () => {
    expect(sampleSizePerArm(0.026, 0.013)).toBeGreaterThan(2800);
  });
});

describe("simulation", () => {
  it("A/A tests hold the false-positive rate near alpha", () => {
    const r = simulateExperiments({ baseline: 0.3, lift: 0, nPerArm: 400, experiments: 2000, seed: 1 });
    expect(r.rate).toBeGreaterThan(0.03);
    expect(r.rate).toBeLessThan(0.07);
  });
  it("peeking inflates false positives", () => {
    const once = simulateExperiments({ baseline: 0.3, lift: 0, nPerArm: 500, experiments: 600, seed: 3 });
    const peek = simulatePeeking({ baseline: 0.3, nPerArm: 500, peekEvery: 25, experiments: 600, seed: 3 });
    expect(peek.rate).toBeGreaterThan(once.rate * 2);
  });
  it("probBBeatsA is ~0.5 for equal data and high for a clear winner", () => {
    expect(probBBeatsA({ conversions: 50, n: 100 }, { conversions: 50, n: 100 })).toBeGreaterThan(0.45);
    expect(probBBeatsA({ conversions: 20, n: 100 }, { conversions: 40, n: 100 })).toBeGreaterThan(0.99);
  });
});

describe("powerTwoProportion", () => {
  it("is about 80% at the computed sample size", () => {
    const n = sampleSizePerArm(0.4, 0.15);
    expect(powerTwoProportion(0.4, 0.15, n)).toBeGreaterThan(0.79);
    expect(powerTwoProportion(0.4, 0.15, n)).toBeLessThan(0.83);
  });
  it("matches simulated power", () => {
    const sim = simulateExperiments({ baseline: 0.4, lift: 0.15, nPerArm: 100, experiments: 3000, seed: 5 });
    expect(Math.abs(sim.rate - powerTwoProportion(0.4, 0.15, 100))).toBeLessThan(0.04);
  });
});
