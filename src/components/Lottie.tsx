import { onSettled, Show } from "solid-js";
import lottie, { AnimationItem } from "lottie-web/build/player/lottie_light";
import logoUrl from "../assets/images/LogoSolo.svg";

interface LottieProps {
  animationData: any;
  loop?: boolean;
  autoplay?: boolean;
  renderer?: "svg" | "canvas" | "html";
  style?: any;
  className?: string;
  hasNeonGlow?: boolean;
  onComplete?: () => void;
  onLoopComplete?: () => void;
  onEnterFrame?: (args: any) => void;
  onSegmentStart?: () => void;
}

const animationEvents = [
  ["complete", "onComplete"],
  ["loopComplete", "onLoopComplete"],
  ["enterFrame", "onEnterFrame"],
  ["segmentStart", "onSegmentStart"],
] as const;

const Lottie = (props: LottieProps) => {
  let containerRef: HTMLDivElement | undefined;
  let anim: AnimationItem | undefined;

  const shouldAnimate =
    typeof sessionStorage === "undefined" ||
    sessionStorage.getItem("shouldAnimate") !== "false";

  onSettled(() => {
    if (containerRef && shouldAnimate) {
      anim = lottie.loadAnimation({
        container: containerRef,
        renderer: props.renderer || "svg",
        loop: props.loop ?? true,
        // If shouldAnimate is false, we force autoplay to false initially
        autoplay: shouldAnimate ?? props.autoplay ?? true,
        animationData: props.animationData,
        rendererSettings: {
          clearCanvas: true,
          progressiveLoad: true,
          hideOnTransparent: true,
        },
      });

      for (const [event, handlerName] of animationEvents) {
        const handler = props[handlerName];
        if (handler) anim.addEventListener(event, handler);
      }

      if (props.hasNeonGlow) {
        containerRef.classList.add("lottie-neon-glow");
      }
    }

    return () => anim?.destroy();
  });


  return (
    <>
      <Show when={shouldAnimate}>
        <div ref={containerRef} style={props.style} class={props.className} />
      </Show>
      <Show when={!shouldAnimate}>
        <img src={logoUrl} alt="" class="w-full h-full" />
      </Show>
    </>
  );
};

export default Lottie;
