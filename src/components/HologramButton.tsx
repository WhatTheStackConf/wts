import { Component, JSX, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";

interface HologramButtonProps extends JSX.HTMLAttributes<any> {
  href?: string;
  text: string;
  target?: string;
  rel?: string;
}

export const HologramButton: Component<HologramButtonProps> = (props) => {
  const [local, others] = splitProps(props, [
    "href",
    "class",
    "text",
    "children",
  ]);

  return (
    <Dynamic
      component={local.href ? "a" : "button"}
      href={local.href}
      class={`btn-hologram rounded-xs flex items-center justify-center text-center decoration-none select-none ${local.class || ""}`}
      {...others}
    >
      <span
        class="text-content font-star uppercase tracking-widest"
        data-text={local.text}
      >
        {local.children || local.text}
      </span>
      <div class="scan-line"></div>
    </Dynamic>
  );
};
