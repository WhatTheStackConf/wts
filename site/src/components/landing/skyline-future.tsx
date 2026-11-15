import { type JSX } from "@solidjs/web";
import { GROUND, box, circle, hLine, line, steps, vLine } from "~/components/landing/skyline-geometry";

// The future layer of the Skopje skyline: a maglev line, air taxis, solar roofs, street trees, and mast beacons.
// It shares the skyline viewBox. The class names are motion hooks in launch-scene.css.
// Without motion, the train waits at the station and the air taxis hold their lanes.

const DECK = 334;
const DECK_DEPTH = 8;
// The line runs past both window edges, because the skyline SVG draws outside its viewBox.
const LINE_SPAN = [-2600, 5000] as const;
const PIER_STEP = 192;
const STATION = { from: 1100, to: 1524 } as const;
const TRAIN = { x: 1132, length: 360, height: 28, cars: 3 } as const;
// The maglev line stands in front of the buildings, so it is drawn larger, scaled about the ground line.
const FORE = `translate(1198 ${GROUND}) scale(1.35) translate(-1198 ${-GROUND})`;

const stroke = { "vector-effect": "non-scaling-stroke" } as const;

function Fill(props: { d: string }): JSX.Element {
  return <path class="skyline-fill" d={props.d} {...stroke} />;
}

function Ink(props: { d: string; dash?: string }): JSX.Element {
  return <path d={props.d} stroke-dasharray={props.dash} {...stroke} />;
}

function pier(x: number): string {
  const fork = DECK + DECK_DEPTH + 16;
  return line(x - 12, DECK + DECK_DEPTH, x, fork) + line(x + 12, DECK + DECK_DEPTH, x, fork) + vLine(x, fork, GROUND);
}

function Viaduct(): JSX.Element {
  const [from, to] = LINE_SPAN;
  const canopy = DECK - 40;
  const posts = [STATION.from + 12, (STATION.from + STATION.to) / 2, STATION.to - 12];
  return (
    <g class="skyline-viaduct">
      <Ink d={steps(from, to, PIER_STEP).map(pier).join("")} />
      <Fill d={box(from, DECK, to - from, DECK_DEPTH)} />
      <Ink d={hLine(from, to, DECK + 3)} dash="1 5" />
      <Fill d={box(STATION.from, canopy, STATION.to - STATION.from, 4)} />
      <Ink d={posts.map((x) => vLine(x, canopy + 4, DECK)).join("")} />
    </g>
  );
}

function Train(): JSX.Element {
  const { x, length, height, cars } = TRAIN;
  const top = DECK - 2 - height;
  const car = length / cars;
  const joints = steps(x + car, x + length - car, car).map((jx) => vLine(jx, top + 3, top + height - 3));
  return (
    <g class="skyline-train">
      <rect class="skyline-fill" x={x} y={top} width={length} height={height} rx={height / 2} {...stroke} />
      <Ink d={hLine(x + 14, x + length - 14, top + 8)} dash="7 4" />
      <Ink d={joints.join("") + hLine(x + 8, x + length - 8, top + height - 5)} />
    </g>
  );
}

type Lane = { name: "near" | "far" | "high"; x: number; y: number; scale: number; heading: 1 | -1 };

// Air taxis: a capsule under two rotor bars, with a dotted wake behind it.
function Craft(props: Lane): JSX.Element {
  const flip = props.scale * props.heading;
  return (
    <g class={`skyline-craft skyline-craft--${props.name}`}>
      <g transform={`translate(${props.x} ${props.y}) scale(${flip} ${props.scale})`}>
        <Ink d={hLine(-96, -26, 1)} dash="2 6" />
        <rect class="skyline-fill" x={-24} y={-6} width={48} height={13} rx={6.5} {...stroke} />
        <Ink d={hLine(-26, -6, -13) + hLine(6, 26, -13) + vLine(-16, -13, -6) + vLine(16, -13, -6) + hLine(4, 18, -1)} />
      </g>
    </g>
  );
}

const FAR_LANES: readonly Lane[] = [
  { name: "far", x: 900, y: 196, scale: 0.9, heading: 1 },
  { name: "high", x: 1460, y: 112, scale: 0.7, heading: 1 },
];
const NEAR_LANES: readonly Lane[] = [{ name: "near", x: 1500, y: 226, scale: 1.7, heading: -1 }];

function solarRow(from: number, to: number, roof: number): string {
  return steps(from, to, 34).map((x) => `M${x} ${roof}l7 -8h24l-7 8Z`).join("");
}

// Solar arrays on the flat roofs between the existing rooftop plant boxes.
function SolarRoofs(): JSX.Element {
  const rows = [
    solarRow(1048, 1074, 318),
    solarRow(1180, 1262, 318),
    solarRow(1396, 1430, 318),
    solarRow(1520, 1554, 318),
    solarRow(1640, 1734, 276),
    solarRow(1826, 1928, 276),
  ];
  return <Fill d={rows.join("")} />;
}

const STREET_TREES: readonly (readonly [x: number, r: number])[] = [
  [404, 15], [446, 12], [488, 15], [972, 13], [1010, 16], [2088, 15], [2128, 12], [2166, 15],
];
const ROOF_TREES: readonly (readonly [x: number, r: number])[] = [[536, 9], [558, 7], [786, 8], [806, 9]];

function tree(x: number, r: number, base: number): { crown: string; trunk: string } {
  const cy = base - r * 1.9;
  return { crown: circle(x, cy, r), trunk: vLine(x, cy + r, base) };
}

function Trees(props: { dots: string }): JSX.Element {
  const all = [
    ...STREET_TREES.map(([x, r]) => tree(x, r, GROUND)),
    ...ROOF_TREES.map(([x, r]) => tree(x, r, 352)),
  ];
  const crowns = all.map((t) => t.crown).join("");
  return (
    <g class="skyline-trees">
      <Ink d={all.map((t) => t.trunk).join("")} />
      <Fill d={crowns} />
      <path d={crowns} fill={props.dots} stroke="none" />
    </g>
  );
}

// Obstruction lights on the masts. The far MRT mast is placed in the far row's scaled coordinates.
const BEACONS: readonly (readonly [x: number, y: number])[] = [[896, 40], [1261, 46], [1668, 146], [1987, 156]];

function Beacons(): JSX.Element {
  return BEACONS.map(([x, y], index) => <path class={`skyline-beacon skyline-beacon--${index % 2 ? "b" : "a"}`} d={circle(x, y, 5)} />);
}

export function FutureDefs(props: { dots: string }): JSX.Element {
  return (
    <>
      <style>
        {":where(.skyline-beacon){fill:var(--color-orbit-amber,#d9921f);stroke:none}"}
      </style>
      <pattern id={props.dots} width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="1.6" fill="currentColor" />
      </pattern>
    </>
  );
}

/** Air traffic behind the near buildings. */
export function FutureFar(): JSX.Element {
  return FAR_LANES.map((lane) => <Craft {...lane} />);
}

/** Roofs, trees, the maglev line, near air traffic, and beacons, in front of the near buildings. */
export function FutureNear(props: { dots: string }): JSX.Element {
  return (
    <>
      <SolarRoofs />
      <Trees dots={`url(#${props.dots})`} />
      <g transform={FORE}>
        <Viaduct />
        <Train />
      </g>
      {NEAR_LANES.map((lane) => <Craft {...lane} />)}
      <Beacons />
    </>
  );
}
