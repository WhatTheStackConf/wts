import { Show } from "solid-js";
import type { PublicSpeakerSummary } from "~/lib/speakers-public";
import { SpeakerAvatar } from "~/components/conference/SpeakerAvatar";

interface SpeakerCardProps {
  speaker: PublicSpeakerSummary;
  layout?: "featured" | "compact" | "grid";
  variant?: "teaser" | "full";
}

function sessionLabel(count: number) {
  if (count === 0) return "Sessions soon";
  if (count === 1) return "1 session";
  return `${count} sessions`;
}

function avatarSize(
  variant: "teaser" | "full",
  layout: "featured" | "compact" | "grid",
): "lg" | "lg-plus" | "xl" {
  if (layout === "grid") return "lg";
  if (variant === "teaser") return "lg-plus";
  return layout === "featured" ? "xl" : "lg";
}

export function SpeakerCard(props: SpeakerCardProps) {
  const variant = () => props.variant ?? "full";
  const isTeaser = () => variant() === "teaser";
  const layout = () => {
    if (isTeaser()) return props.layout ?? "grid";
    return props.layout ?? "featured";
  };
  const isGrid = () => layout() === "grid";

  const cardClass = () => {
    const hologram =
      "cyber-hologram-surface cyber-hologram-card no-underline decoration-none text-inherit outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60";
    if (isGrid()) {
      return `speaker-card-grid-tile speaker-card-grid-tile-hover group flex h-full w-full flex-col rounded-3xl p-5 sm:p-6 min-h-[17rem] ${hologram}`;
    }
    if (isTeaser()) {
      return `speaker-card-teaser speaker-card-teaser-hover group block w-full rounded-3xl focus-visible:ring-primary-400/50 p-7 sm:p-8 md:p-10 min-h-[24rem] sm:min-h-[15rem] ${hologram}`;
    }
    return `speaker-card speaker-card-hover group block rounded-none ${hologram} ${
      layout() === "featured" ? "p-6 sm:p-8" : "p-4"
    }`;
  };

  return (
    <a href={`/speakers/${props.speaker.slug}`} class={cardClass()}>
      <span class="cyber-scan-line" aria-hidden="true" />
      <div
        class={`flex flex-1 gap-5 sm:gap-6 ${
          isGrid()
            ? "flex-col items-center text-center"
            : layout() === "featured"
              ? isTeaser()
                ? "flex-col items-center text-center sm:flex-row sm:items-center sm:text-left"
                : "flex-col items-stretch sm:flex-row sm:items-end"
              : "flex-col items-center text-center"
        }`}
      >
        <div
          class={
            isGrid()
              ? "shrink-0"
              : layout() === "featured"
                ? isTeaser()
                  ? "shrink-0 self-center"
                  : "shrink-0 self-center sm:self-start"
                : "shrink-0"
          }
        >
          <SpeakerAvatar
            name={props.speaker.displayName}
            photoUrl={props.speaker.photoUrl}
            size={avatarSize(variant(), layout())}
            spotlight={false}
          />
        </div>

        <div
          class={`flex flex-1 flex-col min-w-0 w-full ${
            isGrid()
              ? "items-center text-center"
              : layout() === "featured"
                ? isTeaser()
                  ? "items-center text-center sm:items-start sm:text-left"
                  : "text-left"
                : "text-center"
          }`}
        >
          <Show when={isTeaser() && layout() === "featured"}>
            <p class="speaker-teaser-kicker mb-3">Featured speaker</p>
          </Show>
          <h2
            class={`cyber-glitch-label font-star font-bold text-white leading-tight group-hover:text-primary-200 transition-colors ${
              isGrid()
                ? "speaker-grid-name text-xl sm:text-2xl"
                : isTeaser()
                  ? "speaker-teaser-name text-2xl sm:text-3xl"
                  : layout() === "featured"
                    ? "text-2xl sm:text-[clamp(1.5rem,4vw,2.25rem)]"
                    : "text-lg"
            }`}
            data-text={props.speaker.displayName}
          >
            {props.speaker.displayName}
          </h2>
          <Show when={props.speaker.affiliation}>
            <p
              class={`text-secondary-300/90 mt-2 leading-snug ${
                isGrid()
                  ? "text-sm"
                  : isTeaser()
                    ? "text-sm sm:text-base"
                    : layout() === "featured"
                      ? "text-base sm:text-lg"
                      : "text-sm"
              }`}
            >
              {props.speaker.affiliation}
            </p>
          </Show>
          <p
            class={`speaker-session-chip mt-4 ${
              isTeaser() ? "speaker-session-chip-teaser" : ""
            } ${layout() === "grid" || layout() === "compact" ? "mx-auto" : "w-fit"}`}
          >
            {sessionLabel(props.speaker.sessionCount)}
          </p>
        </div>
      </div>

      <Show when={isTeaser() && !isGrid()}>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary-500/35 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          aria-hidden="true"
        />
      </Show>
      <Show when={!isTeaser() || isGrid()}>
        <div
          class="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-500/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          aria-hidden="true"
        />
      </Show>
    </a>
  );
}
