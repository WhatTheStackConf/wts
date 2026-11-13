export const LAUNCH_STATIONS = [
  { id: "countdown", label: "Countdown", datum: "▽ +240 m" },
  { id: "liftoff", label: "Liftoff", datum: "▽ ≈1 km" },
  { id: "max-q", label: "Max-Q", datum: "▽ ≈12 km" },
  { id: "meco", label: "MECO", datum: "▽ ≈50 km" },
  { id: "second-burn", label: "Second burn", datum: "▽ 100 km" },
  { id: "orbit", label: "Orbit", datum: "▽ ≈400 km" },
] as const;

export type LaunchStationId = (typeof LAUNCH_STATIONS)[number]["id"];

export interface LaunchState {
  flight: number;
  station: LaunchStationId;
  altitude: number;
  horizon: number;
  sag: number;
  ground: number;
  cloudRush: number;
  cloudFloor: number;
  streaks: number;
  streaksEdge: number;
  shake: number;
  stars: number;
  night: boolean;
}

type Span = readonly [start: number, end: number];

interface Term {
  gain: number;
  rise: Span;
  fall?: Span;
}

interface Channel {
  base: number;
  min: number;
  max: number;
  terms: readonly Term[];
}

type ChannelName = Exclude<keyof LaunchState, "flight" | "station" | "night">;

const LAST_FLIGHT = LAUNCH_STATIONS.length - 1;
const REACH_LINE = 0.4;
const NIGHT_FROM = 4.65;

// Flight units: station index + progress to the next station. Countdown is constant so the hero
// never shows a partial launch. Each channel is base + Σ gain · smoothstep(rise) · (1 − smoothstep(fall)).
const CHANNELS: Record<ChannelName, Channel> = {
  altitude: {
    base: 1,
    min: 0,
    max: 7,
    terms: [
      { gain: 1.6, rise: [1, 2.15] },
      { gain: 1, rise: [2.15, 3.25] },
      { gain: 1.6, rise: [3.25, 4.4] },
      { gain: 1.8, rise: [4.35, 4.85] },
    ],
  },
  horizon: {
    base: 0.24,
    min: -1,
    max: 1,
    terms: [
      { gain: -0.84, rise: [1, 1.8] },
      { gain: 0.9, rise: [2.9, 3.5] },
      { gain: -0.1, rise: [3.8, 4.5] },
      { gain: -0.12, rise: [4.5, 5] },
    ],
  },
  sag: {
    base: 0,
    min: 0,
    max: 1,
    terms: [
      { gain: 0.05, rise: [2.9, 3.6] },
      { gain: 0.1, rise: [3.7, 4.5] },
      { gain: 0.12, rise: [4.5, 5] },
    ],
  },
  ground: { base: 1, min: 0, max: 1, terms: [{ gain: -1, rise: [1, 1.8] }] },
  cloudRush: { base: 0, min: 0, max: 1, terms: [{ gain: 1, rise: [1.6, 2.15], fall: [2.7, 3] }] },
  cloudFloor: { base: 0, min: 0, max: 1, terms: [{ gain: 1, rise: [2.9, 3.4] }] },
  streaks: {
    base: 0,
    min: 0,
    max: 1,
    terms: [
      { gain: 0.6, rise: [1, 1.25], fall: [1.6, 1.8] },
      { gain: 1, rise: [1.6, 2.15], fall: [2.7, 3] },
      { gain: 0.35, rise: [4, 4.15], fall: [4.4, 4.55] },
    ],
  },
  streaksEdge: {
    base: 0,
    min: 0,
    max: 1,
    terms: [
      { gain: 1, rise: [1, 1.25], fall: [1.6, 2.15] },
      { gain: 1, rise: [2.7, 3] },
    ],
  },
  shake: {
    base: 0,
    min: 0,
    max: 2,
    terms: [
      { gain: 0.5, rise: [1, 1.2], fall: [1.45, 1.8] },
      { gain: 1.2, rise: [1.8, 2.15], fall: [2.7, 3] },
    ],
  },
  stars: { base: 0, min: 0, max: 1, terms: [{ gain: 1, rise: [4.45, 4.9] }] },
};

const CHANNEL_NAMES = Object.keys(CHANNELS) as ChannelName[];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep([start, end]: Span, x: number): number {
  const t = clamp((x - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function termValue(term: Term, flight: number): number {
  const fall = term.fall ? smoothstep(term.fall, flight) : 0;
  return term.gain * smoothstep(term.rise, flight) * (1 - fall);
}

function channelValue(channel: Channel, flight: number): number {
  const sum = channel.terms.reduce((total, term) => total + termValue(term, flight), channel.base);
  return clamp(sum, channel.min, channel.max);
}

function readChannels(flight: number): Record<ChannelName, number> {
  const values = {} as Record<ChannelName, number>;
  for (const name of CHANNEL_NAMES) values[name] = channelValue(CHANNELS[name], flight);
  return values;
}

function toFlight(value: number): number {
  return Number.isNaN(value) ? 0 : clamp(value, 0, LAST_FLIGHT);
}

export function launchState(flight: number): LaunchState {
  const safe = toFlight(flight);
  const station = LAUNCH_STATIONS[Math.floor(safe)].id;
  return { flight: safe, station, ...readChannels(safe), night: safe >= NIGHT_FROM };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function reachLine(scrollY: number, viewportHeight: number): number {
  const scroll = Number.isNaN(scrollY) ? 0 : scrollY;
  const line = scroll + Math.max(0, finiteOr(viewportHeight, 0)) * REACH_LINE;
  return Number.isNaN(line) ? 0 : line;
}

function segmentProgress(tops: readonly number[], line: number): number {
  let index = 0;
  while (tops[index + 1] <= line) index += 1;
  return index + (line - tops[index]) / (tops[index + 1] - tops[index]);
}

/** The reach line can go no lower than at max scroll. Stations below that point move up to it. */
export function reachableTops(tops: readonly number[], maxScroll: number, viewportHeight: number): number[] {
  const lowest = reachLine(Math.max(0, maxScroll), viewportHeight);
  return tops.map((top) => Math.min(top, lowest));
}

export function flightFromScroll(scrollY: number, viewportHeight: number, stationTops: readonly number[]): number {
  const tops = stationTops.filter(Number.isFinite).sort((a, b) => a - b);
  const line = reachLine(scrollY, viewportHeight);
  if (tops.length === 0 || line < tops[0]) return 0;
  if (line >= tops[tops.length - 1]) return LAST_FLIGHT;
  return toFlight(segmentProgress(tops, line));
}
