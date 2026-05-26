import type { JSX } from "solid-js";
import { AVATAR_RING_GLOW, AVATAR_RING_GRADIENT } from "./speaker-avatar-ring";

interface SpeakerAvatarRingProps {
  class?: string;
  glow?: boolean;
  children: JSX.Element;
}

export function SpeakerAvatarRing(props: SpeakerAvatarRingProps) {
  const glow = () => props.glow ?? false;

  return (
    <div
      class={`rounded-full p-[2px] ${props.class ?? ""}`}
      style={{
        background: AVATAR_RING_GRADIENT,
        ...(glow() ? { "box-shadow": AVATAR_RING_GLOW } : {}),
      }}
    >
      <div class="w-full h-full rounded-full overflow-hidden bg-dark-800 relative">
        {props.children}
      </div>
    </div>
  );
}
