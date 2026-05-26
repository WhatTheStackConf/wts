import { Show } from "solid-js";

interface SpeakerAvatarProps {
  name: string;
  photoUrl: string;
  size?: "sm" | "md" | "lg" | "lg-plus" | "xl";
  spotlight?: boolean;
  class?: string;
}

const sizeClass = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
  "lg-plus": "w-40 h-40 sm:w-44 sm:h-44",
  xl: "w-40 h-40 sm:w-44 sm:h-44",
};

export function SpeakerAvatar(props: SpeakerAvatarProps) {
  const size = () => props.size ?? "md";
  const spotlight = () => props.spotlight ?? false;

  return (
    <div
      class={`relative shrink-0 ${props.class ?? ""}`}
    >
      <Show when={spotlight()}>
        <div
          class="absolute -inset-2 rounded-full bg-accent-500/15 blur-md pointer-events-none"
          aria-hidden="true"
        />
      </Show>
      <div
        class={`${sizeClass[size()]} rounded-full overflow-hidden relative bg-dark-800 ${
          spotlight()
            ? "ring-[3px] ring-primary-400/50 shadow-[0_0_28px_color-mix(in_oklch,var(--color-primary-500)_35%,transparent)]"
            : "ring-2 ring-primary-500/30"
        }`}
      >
        <img
          src={props.photoUrl}
          alt={props.name}
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <div
          class="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-dark-950/50 via-transparent to-transparent mix-blend-multiply"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
