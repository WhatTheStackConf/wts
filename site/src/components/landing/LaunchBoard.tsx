import { For, createSignal, onCleanup, onSettled } from "solid-js";
import { FLAP_GLYPHS, FLAP_MS, boardEnd, flapFace, planBoard } from "~/components/landing/launch-board";

const pickGlyph = () => FLAP_GLYPHS[Math.floor(Math.random() * FLAP_GLYPHS.length)] ?? "X";

/** A split-flap readout. The server renders the real characters. With motion allowed, the board
 * starts blank and flaps once to its words. Screen readers get the label only. */
export function LaunchBoard(props: { words: string[]; label: string }) {
  const tiles = planBoard(props.words.join(""), pickGlyph);
  const groups = props.words.reduce<{ start: number; length: number }[]>((all, word) => {
    const last = all.at(-1);
    return [...all, { start: last ? last.start + last.length : 0, length: word.length }];
  }, []);
  const [tick, setTick] = createSignal(Number.POSITIVE_INFINITY);
  const [state, setState] = createSignal<"idle" | "playing" | "done">("idle");
  let timer = 0;

  onSettled(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("done");
      return;
    }
    const end = boardEnd(tiles);
    setTick(0);
    setState("playing");
    timer = window.setInterval(() => {
      const next = tick() + 1;
      setTick(next);
      if (next < end) return;
      window.clearInterval(timer);
      setState("done");
    }, FLAP_MS);
  });
  onCleanup(() => window.clearInterval(timer));

  return (
    <p class="launch-board" data-board={state()}>
      <span class="hud-sr">{props.label}</span>
      <For each={groups}>
        {(group) => (
          <span class="launch-board-word" aria-hidden="true">
            <For each={tiles.slice(group.start, group.start + group.length)}>
              {(tile) => {
                const face = () => flapFace(tile, tick());
                return (
                  <span class="launch-board-tile">
                    <span class="launch-board-half launch-board-half--top">{face().top}</span>
                    <span class="launch-board-half launch-board-half--bottom">{face().bottom}</span>
                  </span>
                );
              }}
            </For>
          </span>
        )}
      </For>
    </p>
  );
}
