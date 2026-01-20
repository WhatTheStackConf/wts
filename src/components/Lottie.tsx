import { onMount, onCleanup, createEffect, Show } from "solid-js";
import lottie, { AnimationItem } from "lottie-web";
import Logo from "../assets/images/LogoSolo.svg?component-solid";

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

const Lottie = (props: LottieProps) => {
  let containerRef: HTMLDivElement | undefined;
  let anim: AnimationItem | undefined;

  const shouldAnimate = sessionStorage.getItem("shouldAnimate") !== "false";

  onMount(() => {
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

      if (props.onComplete) anim.addEventListener("complete", props.onComplete);
      if (props.onLoopComplete)
        anim.addEventListener("loopComplete", props.onLoopComplete);
      if (props.onEnterFrame)
        anim.addEventListener("enterFrame", props.onEnterFrame);
      if (props.onSegmentStart)
        anim.addEventListener("segmentStart", props.onSegmentStart);

      if (props.hasNeonGlow) {
        containerRef.classList.add("lottie-neon-glow");
      }
    }
  });

  // Reactively play/stop based on the shouldAnimate prop
  createEffect(() => {
    const active = shouldAnimate ?? true;
    if (!anim) return;

    if (active) {
      anim.play();
    } else {
      // Go to the last frame and stay there
      anim.goToAndStop(anim.totalFrames, true);
    }
  });

  onCleanup(() => {
    if (anim) anim.destroy();
  });

  return (
    <>
      <Show when={shouldAnimate}>
        <div ref={containerRef} style={props.style} class={props.className} />
      </Show>
      <Show when={!shouldAnimate}>
        <Logo class="w-full h-full" />
      </Show>
    </>
  );
};

export default Lottie;
