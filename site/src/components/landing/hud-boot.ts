/* HUD boot: each [data-hud] block powers on when it climbs into the window. landing-hud.css plays
 * the boot. Without this module, or with reduced motion, every block stays visible. */

export type HudState = "on" | "off";

export interface HudEntry {
  isIntersecting: boolean;
  top: number;
  viewportHeight: number;
}

/** A block powers down only when its layout box is fully below the window, so the next climb replays its boot.
 * The observer measures the clipped box, which collapses while a block is closed. Only the
 * unclipped layout top decides "off", so a block in the bottom margin cannot toggle itself in a loop. */
export function hudTransition(entry: HudEntry): HudState | null {
  if (entry.isIntersecting) return "on";
  return entry.top >= entry.viewportHeight ? "off" : null;
}

export function bootHud(root: HTMLElement): () => void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const state = hudTransition({ isIntersecting: entry.isIntersecting, top: entry.boundingClientRect.top, viewportHeight: window.innerHeight });
      if (state) (entry.target as HTMLElement).dataset.hudState = state;
    }
  }, { rootMargin: "0px 0px -12% 0px" });

  for (const block of root.querySelectorAll<HTMLElement>("[data-hud]")) observer.observe(block);
  root.dataset.hudBoot = "ready";

  return () => {
    observer.disconnect();
    delete root.dataset.hudBoot;
  };
}
