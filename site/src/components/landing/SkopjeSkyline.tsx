import { type JSX } from "@solidjs/web";
import { createUniqueId } from "solid-js";

type Layer = "fill" | "hatch" | "concrete" | "line";
type Shape = readonly [Layer, string];

const GROUND = 388;
const FLOOR = 16;

const n = (value: number) => Math.round(value * 10) / 10;
const box = (x: number, y: number, w: number, h: number) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
const hLine = (x1: number, x2: number, y: number) => `M${n(x1)} ${n(y)}H${n(x2)}`;
const vLine = (x: number, y1: number, y2: number) => `M${n(x)} ${n(y1)}V${n(y2)}`;
const line = (x1: number, y1: number, x2: number, y2: number) => `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
const level = (floor: number) => GROUND - floor * FLOOR;

function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to + 0.001; value += step) out.push(value);
  return out;
}

type Block = { x: number; w: number; floors: number; bay: number; spandrel: number; pilotis?: number };

function block({ x, w, floors, bay, spandrel, pilotis }: Block): Shape[] {
  const top = level(floors + 1) - spandrel;
  const bands: string[] = [];
  const lines: string[] = [];
  for (let floor = 1; floor <= floors + 1; floor++) bands.push(box(x, level(floor) - spandrel, w, spandrel));
  for (let floor = 1; floor <= floors; floor++) {
    for (const mx of steps(x + bay, x + w - bay / 2, bay)) lines.push(vLine(mx, level(floor + 1), level(floor) - spandrel));
  }
  for (const cx of steps(x + (pilotis ?? bay) / 2, x + w, pilotis ?? bay)) {
    if (pilotis) lines.push(box(cx - 2, level(1), 4, FLOOR));
    else lines.push(vLine(cx, level(1), GROUND));
  }
  if (pilotis) lines.push(hLine(x, x + w, level(1) + 5));
  return [["fill", box(x, top, w, GROUND - top)], ["hatch", bands.join("")], ["line", lines.join("")]];
}

function core(x: number, w: number, top: number): Shape[] {
  const slits: string[] = [];
  for (let floor = 1; level(floor + 1) > top + 8; floor += 2) slits.push(vLine(x + w / 2, level(floor + 1) + 3, level(floor) - 3));
  return [["concrete", box(x, top, w, GROUND - top)], ["line", slits.join("")]];
}

function goceDelcev(): Shape[] {
  const tower = 13;
  const coreTop = level(tower + 1) - 26;
  const bridgeTop = level(7) - 7;
  const bridge = [
    ["fill", box(214, bridgeTop, 52, level(6) - bridgeTop)],
    ["hatch", box(214, bridgeTop, 52, 7) + box(214, level(6) - 7, 52, 7)],
    ["line", steps(227, 262, 13).map((x) => vLine(x, level(7), level(6) - 7)).join("")],
  ] as const satisfies Shape[];
  return [
    ...block({ x: 404, w: 70, floors: tower, bay: 17.5, spandrel: 7 }),
    ...core(474, 16, coreTop + 10),
    ...block({ x: 50, w: 70, floors: 5, bay: 14, spandrel: 6 }),
    ...core(120, 18, coreTop),
    ...block({ x: 138, w: 76, floors: tower, bay: 19, spandrel: 7 }),
    ...bridge,
    ...block({ x: 266, w: 76, floors: tower, bay: 19, spandrel: 7 }),
    ...core(342, 18, coreTop),
    ...block({ x: 360, w: 70, floors: 5, bay: 14, spandrel: 6 }),
  ];
}

function crownRibs(cx: number, back: boolean): Shape[] {
  const count = 13;
  const half = 10;
  const yBase = 358;
  const yInner = 240;
  const yTip = 196;
  const shapes: Shape[] = [];
  for (let j = 0; j < count; j++) {
    const angle = (2 * Math.PI * j) / count;
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    if (c < 0 !== back) continue;
    const dir = s >= 0 ? 1 : -1;
    const t = half * Math.abs(c) + 1.5;
    const innerBase = cx + 92 * s - dir * t;
    const outerBase = cx + 110 * s + dir * t;
    const outerTip = cx + 172 * s + dir * t;
    const innerTop = cx + 118 * s - dir * t;
    shapes.push([
      "concrete",
      `M${n(innerBase)} ${yBase}L${n(outerBase)} ${yBase}Q${n(outerBase)} ${yTip + 64} ${n(outerTip)} ${yTip}` +
        `L${n(innerTop)} ${yInner}Q${n(innerBase)} ${yInner + 44} ${n(innerBase)} ${yBase}Z`,
    ]);
  }
  return shapes;
}

function postOffice(): Shape[] {
  const cx = 672;
  const drumTop = 270;
  const drum: Shape[] = [
    ["fill", box(cx - 96, drumTop, 192, 358 - drumTop)],
    ["line", steps(cx - 84, cx + 84, 12).map((x) => vLine(x, drumTop + 10, 358)).join("") + hLine(cx - 96, cx + 96, 310)],
    ["hatch", box(cx - 104, drumTop - 4, 208, 12)],
  ];
  const podium: Shape[] = [
    ["fill", box(520, 352, 304, GROUND - 352)],
    ["hatch", box(520, 352, 304, 9)],
    ["line", steps(532, 814, 16).map((x) => vLine(x, 366, GROUND)).join("") + hLine(520, 824, 366)],
  ];
  const drawers: [number, number, number][] = [[848, 112, 36], [860, 160, 30], [848, 202, 34], [860, 248, 30], [848, 290, 30]];
  const telecom: Shape[] = [
    ["line", vLine(896, 40, 80) + hLine(889, 903, 54) + hLine(891, 901, 66)],
    ["fill", box(878, 80, 36, 12)],
    ...core(870, 52, 92),
    ...drawers.flatMap(([x, y, h]): Shape[] => [
      ["fill", box(x, y, 104, h)],
      ["hatch", box(x, y, 104, 7) + box(x, y + h - 7, 104, 7)],
      ["line", steps(x + 10.4, x + 98, 10.4).map((mx) => vLine(mx, y + 7, y + h - 7)).join("")],
    ]),
  ];
  return [...telecom, ...crownRibs(cx, true), ...drum, ...crownRibs(cx, false), ...podium];
}

function stair(x: number, run: number): Shape {
  const rise = GROUND - 350;
  const treads = steps(0, run, run / 8).map((dx) => vLine(x + dx, GROUND - (rise * dx) / run, GROUND - (rise * dx) / run - 5));
  return ["line", line(x, GROUND, x + run, 350) + line(x, GROUND - 6, x + run, 344) + treads.join("")];
}

function gtc(): Shape[] {
  const x0 = 1040;
  const x1 = 1584;
  return [
    ["fill", box(1108, 306, 64, 12) + box(1296, 302, 92, 16) + box(1460, 308, 52, 10)],
    ["fill", box(x0, 318, x1 - x0, GROUND - 318)],
    ["hatch", box(x0 - 4, 318, x1 - x0 + 4, 8)],
    ["line", steps(x0 + 14, x1 - 6, 14).map((x) => vLine(x, 326, 350)).join("")],
    ["hatch", box(x0 - 12, 350, x1 - x0 + 12, 8)],
    ["line", steps(x0 + 12, x1 - 10, 24).map((x) => vLine(x, 358, GROUND)).join("") + hLine(x0, x1, 368)],
    stair(1196, 44),
    stair(1404, 44),
    ...block({ x: x1, w: 76, floors: 13, bay: 19, spandrel: 5 }),
    ...core(1660, 16, level(14) - 18),
  ];
}

function cityWall(): Shape[] {
  const o = 18;
  const slab = (x: number, w: number, floors: number) => block({ x: x + o, w, floors, bay: 17, spandrel: 6, pilotis: 34 });
  const towerTop = level(14) - 6;
  const crownTop = level(14) + FLOOR * 2;
  return [
    ...slab(1704, 134, 7),
    ...block({ x: 1838 + o, w: 52, floors: 13, bay: 52, spandrel: 4 }),
    ["line", [1851, 1864, 1877].map((x) => vLine(x + o, towerTop, level(1))).join("")],
    ...slab(1890, 142, 7),
    ...block({ x: 2032 + o, w: 54, floors: 11, bay: 13.5, spandrel: 5 }),
    ["fill", box(2040 + o, towerTop, 38, crownTop - towerTop)],
    ["hatch", box(2040 + o, towerTop, 38, 5) + box(2040 + o, level(13) - 5, 38, 5)],
    ["line", vLine(2059 + o, level(14), level(13) - 5) + vLine(2059 + o, level(13), crownTop)],
    ...slab(2086, 52, 5),
  ];
}

// Macedonian Radio Television center: dark glass prisms stepping around a pale stone core, crown with masts.
function mrt(): Shape[] {
  const prisms: [number, number, number][] = [
    [0, 30, 13], [30, 28, 19], [82, 30, 20], [112, 34, 21], [146, 30, 18], [176, 30, 16], [206, 30, 13], [236, 28, 10],
  ];
  const glass = prisms.flatMap(([x, w, floors]): Shape[] => [
    ["concrete", box(x, level(floors), w, GROUND - level(floors))],
    ["line", steps(2, floors - 1, 2).map((floor) => hLine(x, x + w, level(floor))).join("")],
  ]);
  const stone = level(17) - 8;
  const roof = level(21);
  return [
    ...glass,
    ["fill", box(58, stone, 24, GROUND - stone)],
    ["line", steps(3, 15, 4).map((floor) => box(66, level(floor) - 6, 8, 4)).join("")],
    ["fill", box(115, roof - 18, 28, 18) + box(120, roof - 32, 18, 14)],
    ["hatch", box(115, roof - 18, 28, 5)],
    ["line", vLine(129, roof - 32, roof - 62) + vLine(122, roof - 32, roof - 46) + hLine(125, 133, roof - 50)],
  ];
}

type Placement = { shapes: readonly Shape[]; left: number; at: number; scale: number };

// The far row stands behind the near row, smaller and lighter, so the overlaps read as depth.
const FAR = 0.76;
const FAR_OPACITY = 0.58;
const FAR_ROW: readonly Placement[] = [
  { shapes: goceDelcev(), left: 50, at: 330, scale: FAR },
  { shapes: mrt(), left: 0, at: 1150, scale: 0.86 },
];
const NEAR_ROW: readonly Placement[] = [
  { shapes: postOffice(), left: 496, at: 496, scale: 1 },
  { shapes: gtc(), left: 1028, at: 1028, scale: 1 },
  { shapes: cityWall(), left: 1722, at: 1632, scale: 1 },
];

// The drawing spans x 330–2066. Center the viewBox on it so the buildings line up with the hero text.
const WIDTH = 2400;
const VIEW_X = (330 + 2066 - WIDTH) / 2;

const place = (p: Placement) => `translate(${p.at} ${GROUND}) scale(${p.scale}) translate(${-p.left} ${-GROUND})`;

function paint(shapes: readonly Shape[], hatch: string): JSX.Element {
  return shapes.map(([kind, d]) => {
    if (kind === "line") return <path d={d} vector-effect="non-scaling-stroke" />;
    if (kind === "fill") return <path class="skyline-fill" d={d} vector-effect="non-scaling-stroke" />;
    if (kind === "hatch") return <path class="skyline-hatch" d={d} fill={hatch} vector-effect="non-scaling-stroke" />;
    return [
      <path class="skyline-fill" d={d} vector-effect="non-scaling-stroke" />,
      <path class="skyline-hatch" d={d} fill={hatch} stroke="none" />,
    ];
  });
}

function HatchDefs(props: { near: string; far: string }): JSX.Element {
  const pattern = (id: string, size: number) => (
    <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d={`M0 0V${size}`} stroke="currentColor" stroke-opacity="0.32" vector-effect="non-scaling-stroke" />
    </pattern>
  );
  return (
    <defs>
      <style>{":where(.skyline-fill){fill:var(--color-orbit-surface,#fff)}"}</style>
      {pattern(props.near, 6)}
      {pattern(props.far, n(6 / FAR))}
    </defs>
  );
}

function row(placements: readonly Placement[], hatch: string): JSX.Element {
  return placements.map((p) => <g transform={place(p)}>{paint(p.shapes, hatch)}</g>);
}

type ArtProps = { class?: string };

export function SkopjeSkyline(props: ArtProps = {}): JSX.Element {
  const id = createUniqueId();
  const near = `skyline-hatch-${id}`;
  const far = `skyline-hatch-far-${id}`;
  return (
    <svg
      class={props.class ? `skopje-skyline ${props.class}` : "skopje-skyline"}
      viewBox={`${VIEW_X} 0 ${WIDTH} 400`}
      preserveAspectRatio="xMidYMax meet"
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      aria-hidden="true"
    >
      <HatchDefs near={near} far={far} />
      <g opacity={FAR_OPACITY}>{row(FAR_ROW, `url(#${far})`)}</g>
      {row(NEAR_ROW, `url(#${near})`)}
      <path d={hLine(VIEW_X, VIEW_X + WIDTH, GROUND)} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
