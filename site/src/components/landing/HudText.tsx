import { For } from "solid-js";

/** Text that hud-decrypt.ts can resolve from glyphs. Screen readers read the hidden copy as one
 * string, because some readers spell out text that is split into one span per letter.
 * Each word keeps its letters together, so a heading never wraps inside a word. */
export function HudText(props: { lines: string[] }) {
  return (
    <>
      <span class="hud-sr">{props.lines.join(" ")}</span>
      <span class="hud-glyphs" aria-hidden="true" data-hud-decrypt>
        <For each={props.lines}>
          {(line, lineIndex) => (
            <>
              {lineIndex() > 0 ? <br /> : null}
              <For each={line.split(" ")}>
                {(word, wordIndex) => (
                  <>
                    {wordIndex() > 0 ? " " : null}
                    <span class="hud-word">
                      <For each={Array.from(word)}>{(letter) => <span class="hud-ch">{letter}</span>}</For>
                    </span>
                  </>
                )}
              </For>
            </>
          )}
        </For>
      </span>
    </>
  );
}
