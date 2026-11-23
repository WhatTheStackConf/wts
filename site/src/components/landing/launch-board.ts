/* Launch board: a split-flap readout of real edition facts. The idea comes from SplitFlapText in
 * Solid Bits (solid-bits.dev). This is a smaller WTS version with no 3D fold: each flap step shows
 * the next character in the top half while the bottom half still shows the last one.
 * Clock: one flap per sixteenth note (75 ms), two per eighth. It plays once, in under 1.5 s. */

export const FLAP_MS = 75;
export const FLAP_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface FlapTile {
  /** Blank first, then random glyphs, then the real character. */
  sequence: string[];
  /** The tick on which the tile starts to flap. */
  start: number;
}

export interface FlapFace {
  top: string;
  bottom: string;
}

/** One tile per character. Tiles start one tick apart, and each flaps through 3 to 5 glyphs. */
export function planBoard(text: string, pick: () => string): FlapTile[] {
  return Array.from(text, (final, index) => ({
    sequence: [" ", ...Array.from({ length: 3 + (index % 3) }, pick), final],
    start: index,
  }));
}

const at = (sequence: string[], step: number) => sequence[Math.min(Math.max(step, 0), sequence.length - 1)] ?? " ";

/** The two halves of a tile at a tick. The bottom half follows the top half one tick later. */
export function flapFace(tile: FlapTile, tick: number): FlapFace {
  const step = tick - tile.start;
  return { top: at(tile.sequence, step), bottom: at(tile.sequence, step - 1) };
}

/** The tick after which every tile shows its real character in both halves. */
export function boardEnd(tiles: FlapTile[]): number {
  return Math.max(0, ...tiles.map((tile) => tile.start + tile.sequence.length));
}
