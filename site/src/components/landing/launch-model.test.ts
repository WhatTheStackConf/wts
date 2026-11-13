import { describe, expect, it } from "vite-plus/test";
import {
  LAUNCH_STATIONS,
  flightFromScroll,
  reachableTops,
  launchState,
  type LaunchState,
} from "~/components/landing/launch-model";

const NUMERIC_FIELDS = [
  "flight",
  "altitude",
  "horizon",
  "sag",
  "ground",
  "cloudRush",
  "cloudFloor",
  "streaks",
  "streaksEdge",
  "shake",
  "stars",
] as const satisfies readonly (keyof LaunchState)[];

const UNIT_FIELDS = ["ground", "cloudRush", "cloudFloor", "streaks", "streaksEdge", "stars"] as const;

function samples(from: number, to: number, count = 40): number[] {
  return Array.from({ length: count + 1 }, (_, index) => from + ((to - from) * index) / count);
}

function maxOf(from: number, to: number, read: (state: LaunchState) => number): number {
  return Math.max(...samples(from, to).map((flight) => read(launchState(flight))));
}

describe("launchState stations", () => {
  it("names the station from the integer part of flight", () => {
    expect(LAUNCH_STATIONS.map((station) => station.id)).toEqual([
      "countdown",
      "liftoff",
      "max-q",
      "meco",
      "second-burn",
      "orbit",
    ]);
    expect(launchState(0).station).toBe("countdown");
    expect(launchState(1.5).station).toBe("liftoff");
    expect(launchState(2.99).station).toBe("max-q");
    expect(launchState(3).station).toBe("meco");
    expect(launchState(4.2).station).toBe("second-burn");
    expect(launchState(5).station).toBe("orbit");
  });

  it("holds the countdown on the ground and still", () => {
    for (const flight of samples(0, 0.999)) {
      const state = launchState(flight);
      expect(state.ground).toBe(1);
      expect(state.shake).toBe(0);
      expect(state.streaks).toBe(0);
      expect(state.night).toBe(false);
    }
  });

  it("clears the ground during liftoff and shows edge streaks", () => {
    expect(launchState(1).ground).toBe(1);
    expect(launchState(1.999).ground).toBeCloseTo(0, 5);
    const early = launchState(1.3);
    expect(early.streaks).toBeGreaterThan(0);
    expect(early.streaksEdge).toBeGreaterThan(0.9);
  });

  it("peaks the cloud rush and the baseline shake at max-Q", () => {
    const rushAtMaxQ = maxOf(2, 2.999, (state) => state.cloudRush);
    expect(rushAtMaxQ).toBeCloseTo(1, 5);
    expect(rushAtMaxQ).toBeGreaterThanOrEqual(maxOf(0, 5, (state) => state.cloudRush));
    const shakeAtMaxQ = maxOf(2, 2.999, (state) => state.shake);
    expect(shakeAtMaxQ).toBeGreaterThan(0);
    expect(shakeAtMaxQ).toBeLessThanOrEqual(2);
    expect(shakeAtMaxQ).toBeGreaterThanOrEqual(maxOf(0, 5, (state) => state.shake));
  });

  it("goes quiet at MECO while the cloud floor rises and the horizon curves", () => {
    for (const flight of samples(3, 3.999)) {
      const state = launchState(flight);
      expect(state.shake).toBe(0);
      expect(state.streaks).toBe(0);
      expect(state.cloudRush).toBe(0);
      expect(state.sag).toBeGreaterThan(0);
    }
    expect(launchState(3.9).cloudFloor).toBeGreaterThan(launchState(3).cloudFloor);
    expect(launchState(3.9).cloudFloor).toBeGreaterThan(0.9);
  });

  it("grows the sag in the second burn and turns night in its last part", () => {
    expect(launchState(4.9).sag).toBeGreaterThan(launchState(4).sag);
    expect(launchState(4).night).toBe(false);
    expect(launchState(4.3).night).toBe(false);
    expect(launchState(4.9).night).toBe(true);
  });

  it("reaches orbit with stars, night, and full altitude", () => {
    const orbit = launchState(5);
    expect(orbit.stars).toBeGreaterThan(0.95);
    expect(orbit.night).toBe(true);
    expect(orbit.altitude).toBeCloseTo(7, 2);
  });
});

describe("launchState invariants", () => {
  it("returns finite outputs in range for any input", () => {
    const inputs = [NaN, Infinity, -Infinity, -100, -0.5, ...samples(0, 5, 200), 5.5, 1e9];
    for (const input of inputs) {
      const state = launchState(input);
      for (const field of NUMERIC_FIELDS) expect(Number.isFinite(state[field])).toBe(true);
      for (const field of UNIT_FIELDS) {
        expect(state[field]).toBeGreaterThanOrEqual(0);
        expect(state[field]).toBeLessThanOrEqual(1);
      }
      expect(state.altitude).toBeGreaterThanOrEqual(0);
      expect(state.altitude).toBeLessThanOrEqual(7);
    }
  });

  it("treats NaN and -Infinity as 0 and Infinity as 5", () => {
    expect(launchState(NaN)).toEqual(launchState(0));
    expect(launchState(-Infinity)).toEqual(launchState(0));
    expect(launchState(Infinity)).toEqual(launchState(5));
    expect(launchState(NaN).flight).toBe(0);
    expect(launchState(Infinity).flight).toBe(5);
  });

  it("never lowers the altitude as flight grows", () => {
    let previous = -Infinity;
    for (const flight of samples(-1, 6, 700)) {
      const { altitude } = launchState(flight);
      expect(altitude).toBeGreaterThanOrEqual(previous);
      previous = altitude;
    }
  });
});

describe("flightFromScroll", () => {
  const viewport = 1000;
  const tops = [0, 1000, 2000, 3000, 4000, 5000];
  const at = (stationTop: number) => stationTop - viewport * 0.4;

  it("reaches a station when its top crosses 40% of the viewport", () => {
    expect(flightFromScroll(at(1000), viewport, tops)).toBe(1);
    expect(flightFromScroll(at(3000), viewport, tops)).toBe(3);
    expect(flightFromScroll(at(1500), viewport, tops)).toBeCloseTo(1.5, 10);
  });

  it("is 0 before the first station and 5 after the last", () => {
    expect(flightFromScroll(0, viewport, [800, 1800, 2800, 3800, 4800, 5800])).toBe(0);
    expect(flightFromScroll(at(5000), viewport, tops)).toBe(5);
    expect(flightFromScroll(99_999, viewport, tops)).toBe(5);
  });

  it("sorts unsorted tops", () => {
    const shuffled = [3000, 0, 5000, 1000, 4000, 2000];
    expect(flightFromScroll(at(2500), viewport, shuffled)).toBeCloseTo(2.5, 10);
  });

  it("returns a finite flight for empty lists and invalid numbers", () => {
    expect(flightFromScroll(500, viewport, [])).toBe(0);
    const cases: [number, number, readonly number[]][] = [
      [NaN, viewport, tops],
      [Infinity, viewport, tops],
      [-Infinity, viewport, tops],
      [500, NaN, tops],
      [500, -Infinity, tops],
      [500, viewport, [NaN, 0, Infinity, 1000]],
      [500, viewport, [1000, 1000, 1000, 1000, 1000, 1000]],
    ];
    for (const [scrollY, height, list] of cases) {
      const flight = flightFromScroll(scrollY, height, list);
      expect(Number.isFinite(flight)).toBe(true);
      expect(flight).toBeGreaterThanOrEqual(0);
      expect(flight).toBeLessThanOrEqual(5);
    }
  });
});

describe("reachableTops", () => {
  it("pulls stations below the last reach line up to it, so the final station plays at max scroll", () => {
    // maxScroll 1000, viewport 800: the reach line can go no lower than 1000 + 0.4 * 800 = 1320.
    expect(reachableTops([0, 900, 1500, 1600], 1000, 800)).toEqual([0, 900, 1320, 1320]);
  });

  it("keeps reachable stations where they are", () => {
    expect(reachableTops([0, 400, 800], 2000, 800)).toEqual([0, 400, 800]);
  });

  it("returns finite flight 5 at max scroll after the pull", () => {
    const tops = reachableTops([0, 900, 1100, 1300, 1500, 1700], 1000, 800);
    expect(flightFromScroll(1000, 800, tops)).toBe(5);
  });
});
