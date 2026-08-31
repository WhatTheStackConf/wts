import type { Component } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import { omit } from "solid-js";

interface HologramButtonProps extends JSX.HTMLAttributes<any> {
  href?: string;
  text: string;
  target?: string;
  rel?: string;
}

export const HologramButton: Component<HologramButtonProps> = (props) => {
  const others = omit(props, "href", "class", "text", "children");

  return (
    <Dynamic
      component={props.href ? "a" : "button"}
      href={props.href}
      class={`btn-hologram cyber-hologram-surface rounded-xs flex items-center justify-center text-center decoration-none select-none ${props.class || ""}`}
      {...others}
    >
      <span
        class="text-content font-star uppercase tracking-widest"
        data-text={props.text}
      >
        {props.children || props.text}
      </span>
      <div class="scan-line cyber-scan-line" aria-hidden="true" />
    </Dynamic>
  );
};
