import { For, Show } from "solid-js";
import type { PublicAppearanceEvent } from "~/lib/speakers-public";

interface AppearanceRibbonsProps {
  events: PublicAppearanceEvent[];
  variant: "listing" | "profile";
}

export function AppearanceRibbons(props: AppearanceRibbonsProps) {
  const firstEvent = () => props.events[0];
  const additionalCount = () => Math.max(0, props.events.length - 1);
  const appearanceDescription = () =>
    `Appearing at: ${props.events.map((event) => event.name).join(", ")}`;

  return (
    <Show when={props.events.length > 0}>
      <Show
        when={props.variant === "listing"}
        fallback={
          <div class="appearance-ribbons appearance-ribbons-profile" role="group" aria-label="Appearing at">
            <p class="appearance-ribbons-label">Appearing at</p>
            <ul class="appearance-ribbons-list">
              <For each={props.events}>
                {(event) => (
                  <li class="appearance-ribbon">
                    <span>{event.name}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        }
      >
        <div class="appearance-corner-ribbon">
          <span class="sr-only">{appearanceDescription()}</span>
          <span class="appearance-corner-ribbon-band" aria-hidden="true">
            <span class="appearance-corner-ribbon-event">{firstEvent().compactLabel}</span>
            <Show when={additionalCount() > 0}>
              <span class="appearance-corner-ribbon-count">+{additionalCount()}</span>
            </Show>
          </span>
        </div>
      </Show>
    </Show>
  );
}
