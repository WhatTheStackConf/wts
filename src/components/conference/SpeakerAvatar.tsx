import { Show } from "solid-js";
import { SpeakerAvatarRing } from "./SpeakerAvatarRing";
import {
  pocketBaseThumbnailSrcSet,
  pocketBaseThumbnailUrl,
} from "~/lib/pocketbase-thumbnail";

interface SpeakerAvatarProps {
  name: string;
  photoUrl: string | null;
  size?: "sm" | "md" | "lg" | "lg-plus" | "xl" | "promo";
  glow?: boolean;
  spotlight?: boolean;
  class?: string;
}

const sizeClass = {
  sm: "w-16 h-16",
  md: "w-24 h-24",
  lg: "w-32 h-32",
  "lg-plus": "w-40 h-40 sm:w-44 sm:h-44",
  xl: "w-40 h-40 sm:w-44 sm:h-44",
  promo: "w-28 h-28 sm:w-36 sm:h-36",
};

const imageSizes = {
  sm: "64px",
  md: "96px",
  lg: "128px",
  "lg-plus": "(min-width: 640px) 176px, 160px",
  xl: "(min-width: 640px) 176px, 160px",
  promo: "(min-width: 640px) 144px, 112px",
};

function speakerInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "WTS";
}

export function SpeakerAvatar(props: SpeakerAvatarProps) {
  const size = () => props.size ?? "md";
  const glow = () => props.glow ?? true;
  const spotlight = () => props.spotlight ?? false;

  return (
    <div class={`relative shrink-0 ${props.class ?? ""}`}>
      <Show when={spotlight()}>
        <div
          class="absolute -inset-2 rounded-full bg-accent-500/15 blur-md pointer-events-none"
          aria-hidden="true"
        />
      </Show>
      <SpeakerAvatarRing class={sizeClass[size()]} glow={glow()}>
        <Show
          when={props.photoUrl}
          fallback={
            <div
              class="flex h-full w-full items-center justify-center bg-gradient-to-br from-dark-800 via-dark-900 to-primary-950 font-star text-xl font-bold tracking-wide text-secondary-200"
              aria-hidden="true"
            >
              {speakerInitials(props.name)}
            </div>
          }
        >
          {(photoUrl) => (
            <img
              src={pocketBaseThumbnailUrl(photoUrl(), "256x256")}
              srcset={pocketBaseThumbnailSrcSet(photoUrl(), [128, 256, 384])}
              sizes={imageSizes[size()]}
              alt={props.name}
              class="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          )}
        </Show>
        <div
          class="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-t from-dark-950/50 via-transparent to-transparent mix-blend-multiply"
          aria-hidden="true"
        />
      </SpeakerAvatarRing>
    </div>
  );
}
