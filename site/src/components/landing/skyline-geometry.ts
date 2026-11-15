// Path helpers for the Skopje skyline drawing. Units are viewBox units. The ground line is at y 388.
export const GROUND = 388;
export const FLOOR = 16;

export const n = (value: number) => Math.round(value * 10) / 10;
export const box = (x: number, y: number, w: number, h: number) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
export const hLine = (x1: number, x2: number, y: number) => `M${n(x1)} ${n(y)}H${n(x2)}`;
export const vLine = (x: number, y1: number, y2: number) => `M${n(x)} ${n(y1)}V${n(y2)}`;
export const line = (x1: number, y1: number, x2: number, y2: number) => `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`;
export const level = (floor: number) => GROUND - floor * FLOOR;
export const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

export function steps(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let value = from; value <= to + 0.001; value += step) out.push(value);
  return out;
}
