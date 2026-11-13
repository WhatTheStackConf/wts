import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";

interface PageBandProps {
  title: JSX.Element;
  lede?: JSX.Element;
  /** `short` serves detail and form pages. `tall` serves the CFP landing and dashboards. */
  size?: "tall" | "short";
  /** The CFP landing pulls its status panel up over the lower band. */
  overlap?: boolean;
}

/** Applicant sky band: ALT 3 of the orbit altitude ramp, with still streaks and the page title. */
export function PageBand(props: PageBandProps) {
  return <header class="page-band" data-size={props.size ?? "tall"} data-overlap={props.overlap ? "true" : undefined}>
    <div class="page-band-sky" aria-hidden="true">
      <span /><span /><span /><span /><span /><span /><span />
    </div>
    <div class="page-band-inner">
      <p class="page-band-label"><span>WTS 2027 · Call for Papers</span><span class="page-band-datum" aria-hidden="true">▽ ALT 3</span></p>
      <h1 class="page-title">{props.title}</h1>
      <Show when={props.lede}><p class="page-band-lede">{props.lede}</p></Show>
    </div>
  </header>;
}
