import { For, Show, createSignal, onSettled } from "solid-js";
import { daysUntil } from "~/components/landing/t-minus";

const DIGITS = Array.from("0123456789");

/** An odometer of days to the conference. It renders nothing until the date is announced.
 * The count runs in the browser, so a cached page never shows yesterday's number.
 * Each digit drum rolls once, in stepped sixteenths, to its value. */
export function TMinus(props: { localDate?: string; timeZone: string; label: string }) {
  const [days, setDays] = createSignal<number | null>(null);
  onSettled(() => {
    if (props.localDate) setDays(daysUntil(new Date(), props.localDate, props.timeZone));
  });

  return (
    <Show when={days()}>
      {(count) => (
        <p class="launch-tminus">
          <span class="hud-sr">{`${count()} days to ${props.label}`}</span>
          <span class="launch-tminus-readout" aria-hidden="true">
            <span class="launch-tminus-prefix">T−</span>
            <For each={Array.from(String(count()))}>
              {(digit) => (
                <span class="launch-tminus-drum" style={{ "--digit": digit }}>
                  <span class="launch-tminus-strip"><For each={DIGITS}>{(value) => <span>{value}</span>}</For></span>
                </span>
              )}
            </For>
            <span class="launch-tminus-unit">days</span>
          </span>
        </p>
      )}
    </Show>
  );
}
