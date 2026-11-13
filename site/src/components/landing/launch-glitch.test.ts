import { describe, expect, it } from "vite-plus/test";
import {
  AMBIENT_BARS,
  BAR_MS,
  GLITCH_MS,
  glitchStrength,
  mayGlitch,
  nextAmbientDelay,
} from "~/components/landing/launch-glitch";

describe("glitchStrength", () => {
  it("hits hard at the start of a glitch", () => {
    expect(glitchStrength(0)).toBe(1);
  });

  it("is clean before a glitch and after its short life", () => {
    for (const age of [-1, GLITCH_MS, GLITCH_MS * 4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(glitchStrength(age)).toBe(0);
    }
  });

  it("stays inside 0 to 1 and changes at most twice during one glitch", () => {
    let changes = 0;
    let previous = glitchStrength(0);
    for (let age = 0; age <= GLITCH_MS; age += 4) {
      const strength = glitchStrength(age);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
      if (strength !== previous && strength > 0) changes += 1;
      previous = strength;
    }
    expect(changes).toBeLessThanOrEqual(2);
  });
});

describe("nextAmbientDelay", () => {
  it("waits a whole number of bars inside the ambient range", () => {
    for (const random of [0, 0.2, 0.5, 0.999, 1]) {
      const delay = nextAmbientDelay(random);
      expect(delay % BAR_MS).toBe(0);
      expect(delay).toBeGreaterThanOrEqual(AMBIENT_BARS[0] * BAR_MS);
      expect(delay).toBeLessThanOrEqual(AMBIENT_BARS[1] * BAR_MS);
    }
  });

  it("gives a finite delay for a broken random value", () => {
    expect(nextAmbientDelay(Number.NaN)).toBe(AMBIENT_BARS[0] * BAR_MS);
  });
});

describe("mayGlitch", () => {
  it("allows at most one glitch per bar, far below three flashes per second", () => {
    expect(mayGlitch(10_000, Number.NEGATIVE_INFINITY)).toBe(true);
    expect(mayGlitch(10_000, 10_000 - BAR_MS + 1)).toBe(false);
    expect(mayGlitch(10_000, 10_000 - BAR_MS)).toBe(true);
  });
});
