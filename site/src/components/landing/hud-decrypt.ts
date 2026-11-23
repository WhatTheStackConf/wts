/* Decrypted headings: during the HUD boot, a heading resolves from random glyphs to its real text.
 * The idea comes from DecryptedText in Solid Bits (solid-bits.dev). This is a smaller WTS version.
 * The real letters stay in the DOM. A data-glyph attribute paints a glyph over a letter, so copy,
 * search and layout always use the real text. Screen readers get the text from HudText.
 * Clock: one frame per eighth note (150 ms). Four frames make one beat. */

export const DECRYPT_GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
export const DECRYPT_FRAMES = 4;
const FRAME_MS = 150;
const LEAD_MS = 300;

/** The glyph for each letter at a frame. Null means the letter shows its real character.
 * Letters resolve from left to right, and the last frame shows the real text. */
export function decryptFrame(length: number, frame: number, frames: number, pick: () => string): (string | null)[] {
  const revealed = Math.ceil((length * Math.min(Math.max(frame, 0), frames)) / frames);
  return Array.from({ length }, (_, index) => (index < revealed ? null : pick()));
}

const running = new WeakMap<HTMLElement, () => void>();

function randomGlyph(): string {
  return DECRYPT_GLYPHS[Math.floor(Math.random() * DECRYPT_GLYPHS.length)] ?? "X";
}

function paint(letters: HTMLElement[], glyphs: (string | null)[]): void {
  letters.forEach((letter, index) => {
    const glyph = glyphs[index];
    if (glyph) letter.dataset.glyph = glyph;
    else delete letter.dataset.glyph;
  });
}

/** The delay of a line matches its CSS boot slot: the panel lead plus one eighth per --hud-i step. */
function lineDelay(target: HTMLElement): number {
  const line = target.closest<HTMLElement>("[data-hud-line]");
  const index = Number.parseFloat(line ? getComputedStyle(line).getPropertyValue("--hud-i") : "") || 0;
  const lead = target.closest(".orbit-panel") ? LEAD_MS : 0;
  return lead + index * FRAME_MS;
}

function runTarget(target: HTMLElement): () => void {
  const letters = [...target.querySelectorAll<HTMLElement>(".hud-ch")];
  let frame = 0;
  let timer = 0;
  const step = () => {
    paint(letters, decryptFrame(letters.length, frame, DECRYPT_FRAMES, randomGlyph));
    frame += 1;
    if (frame <= DECRYPT_FRAMES) timer = window.setTimeout(step, FRAME_MS);
  };
  paint(letters, decryptFrame(letters.length, 0, DECRYPT_FRAMES, randomGlyph));
  timer = window.setTimeout(step, lineDelay(target));
  return () => {
    window.clearTimeout(timer);
    paint(letters, []);
  };
}

/** Starts or stops the decrypt of every [data-hud-decrypt] target in a block. */
export function decryptBlock(block: HTMLElement, on: boolean): void {
  for (const target of block.querySelectorAll<HTMLElement>("[data-hud-decrypt]")) {
    running.get(target)?.();
    running.delete(target);
    if (on && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) running.set(target, runTarget(target));
  }
}
