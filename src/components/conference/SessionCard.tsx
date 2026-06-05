import { Show } from "solid-js";
import type { PublicSessionCard } from "~/lib/speakers-public";

interface SessionCardProps {
  session: PublicSessionCard;
}

export function SessionCard(props: SessionCardProps) {
  return (
    <a
      href={`/sessions/${props.session.slug}`}
      class="speaker-card-grid-tile speaker-card-grid-tile-hover group flex h-full w-full flex-col items-center text-center justify-center rounded-3xl p-5 sm:p-6 min-h-[17rem] cyber-hologram-surface cyber-hologram-card no-underline decoration-none text-inherit outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
    >
      <span class="cyber-scan-line" aria-hidden="true" />
      <Show when={props.session.format}>
        <p class="speaker-teaser-kicker mb-4">{props.session.format}</p>
      </Show>
      <h2
        class="cyber-glitch-label font-star font-bold text-white leading-tight group-hover:text-primary-200 transition-colors speaker-grid-name text-xl sm:text-2xl"
        data-text={props.session.title}
      >
        {props.session.title}
      </h2>
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        aria-hidden="true"
      />
    </a>
  );
}
