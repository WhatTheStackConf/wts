import { For, Show } from "solid-js";
import { HologramButton } from "~/components/HologramButton";
import {
  conferenceWeekCta,
  conferenceWeekDayLabel,
  conferenceWeekEyebrow,
  conferenceWeekHeadline,
  conferenceWeekIntro,
  conferenceWeekRange,
  conferenceWeekTracks,
  type ConferenceWeekTrack,
} from "~/lib/conference-week";

function TrackCard(props: { track: ConferenceWeekTrack }) {
  const external = () => Boolean(props.track.href?.startsWith("http"));

  return (
    <li class={`min-w-0 h-full ${props.track.fullWidth ? "md:col-span-2" : ""}`}>
      <article
        class="week-track-card group relative flex h-full w-full flex-col rounded-2xl border border-primary-500/25 p-5 md:p-6"
        data-placeholder={props.track.placeholder ? "true" : undefined}
      >
        <span class="cyber-scan-line" aria-hidden="true" />

        <div class="relative z-10 mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 class="font-star text-xl uppercase tracking-widest text-primary-300 md:text-2xl">
            <Show when={props.track.href} fallback={props.track.name}>
              <a
                href={props.track.href}
                target={external() ? "_blank" : undefined}
                rel={external() ? "noopener noreferrer" : undefined}
                class="week-track-title-link no-underline"
              >
                {props.track.name}
                <Show when={external()}>
                  <span aria-hidden="true"> &#8599;</span>
                </Show>
              </a>
            </Show>
          </h3>
          <p class="m-0 shrink-0 font-mono text-xs font-bold uppercase tracking-[0.2em] text-accent-300">
            <Show when={props.track.date} fallback="Date to be announced">
              {conferenceWeekDayLabel(props.track.date!)}
            </Show>
          </p>
        </div>

        <p class="relative z-10 m-0 text-base leading-relaxed text-dark-50">
          {props.track.summary}
        </p>

        <Show when={props.track.highlights?.length}>
          <ul class="relative z-10 mt-4 list-none border-t border-white/10 p-0 pt-3">
            <For each={props.track.highlights}>
              {(highlight) => (
                <li class="py-1 text-sm leading-snug text-dark-50">
                  {`>`} {highlight}
                </li>
              )}
            </For>
            <Show when={props.track.moreSpeakers}>
              <li class="py-1 text-sm leading-snug text-dark-50/60">and more...</li>
            </Show>
          </ul>
        </Show>

        <Show when={props.track.topics?.length}>
          <div class="relative z-10 mt-4 border-t border-white/10 pt-3">
            <p class="m-0 mb-2 font-mono text-xs uppercase tracking-[0.18em] text-secondary-300">
              On the agenda
            </p>
            <ul class="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm text-dark-50">
              <For each={props.track.topics}>
                {(topic) => <li>{`>`} {topic}</li>}
              </For>
            </ul>
          </div>
        </Show>

        <Show when={props.track.cta}>
          <div class="relative z-10 mt-auto border-t border-white/10 pt-4">
            <a
              href={props.track.cta!.href}
              target="_blank"
              rel="noopener noreferrer"
              class="week-entry-cta no-underline"
            >
              {props.track.cta!.label}
              <span aria-hidden="true"> &#8599;</span>
            </a>
          </div>
        </Show>

        <Show when={props.track.access}>
          <div class="relative z-10 mt-auto border-t border-white/10 pt-4">
            <p class="m-0 text-sm leading-snug text-dark-50">
              <span class="font-mono text-xs uppercase tracking-[0.18em] text-secondary-300">
                Entry
              </span>{" "}
              {props.track.access}
            </p>
          </div>
        </Show>
      </article>
    </li>
  );
}

export function ConferenceWeek() {
  return (
    <section class="w-full max-w-6xl mx-auto px-3 md:px-0 pt-16 md:pt-20 pb-12 md:pb-16 fade-in-delay-1">
      <div class="glass-panel grid-scan rounded-3xl p-6 md:p-10 lg:p-12">
        <header class="relative z-30 mb-8 md:mb-10">
          <p class="mb-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-accent-300">
            {conferenceWeekEyebrow} // {conferenceWeekRange}
          </p>
          <h2 class="max-w-3xl text-balance font-star text-3xl font-bold uppercase leading-tight tracking-widest text-primary-500 md:text-5xl">
            {conferenceWeekHeadline}
          </h2>
          <p class="mt-5 max-w-2xl text-pretty text-lg font-light leading-relaxed text-dark-50">
            {conferenceWeekIntro}
          </p>
        </header>

        <ul class="relative z-30 grid list-none grid-cols-1 gap-4 p-0 m-0 md:grid-cols-2 md:gap-5">
          <For each={conferenceWeekTracks}>
            {(track) => <TrackCard track={track} />}
          </For>
        </ul>

        <div class="relative z-30 mt-10 flex justify-center border-t border-white/15 pt-8 md:mt-12">
          <HologramButton
            href={conferenceWeekCta.href}
            text={conferenceWeekCta.text}
            class="px-7 py-3 text-lg neon-glow"
          />
        </div>
      </div>
    </section>
  );
}
