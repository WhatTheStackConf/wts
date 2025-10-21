import { onMount, onCleanup } from "solid-js";
import lottie from "lottie-web";

interface LottieProps {
  animationData: any;
  loop?: boolean;
  autoplay?: boolean;
  renderer?: "svg" | "canvas" | "html";
  style?: any;
  className?: string;
  hasNeonGlow?: boolean; // Add neon glow effect
  onComplete?: () => void;
  onLoopComplete?: () => void;
  onEnterFrame?: (args: any) => void;
  onSegmentStart?: () => void;
}

export const Lottie = (props: LottieProps) => {
  let containerRef: HTMLDivElement | undefined;
  let anim: any;

  onMount(() => {
    if (containerRef) {
      anim = lottie.loadAnimation({
        container: containerRef,
        renderer: props.renderer || "svg",
        loop: props.loop !== undefined ? props.loop : true,
        autoplay: props.autoplay !== undefined ? props.autoplay : true,
        animationData: props.animationData,
        rendererSettings: {
          clearCanvas: true,
          progressiveLoad: true,
          hideOnTransparent: true,
        },
      });

      // Register event handlers if provided
      if (props.onComplete) anim.addEventListener("complete", props.onComplete);
      if (props.onLoopComplete)
        anim.addEventListener("loopComplete", props.onLoopComplete);
      if (props.onEnterFrame)
        anim.addEventListener("enterFrame", props.onEnterFrame);
      if (props.onSegmentStart)
        anim.addEventListener("segmentStart", props.onSegmentStart);

      // Add neon glow effect if requested
      if (props.hasNeonGlow) {
        // Add the neon glow class to the container
        containerRef.classList.add("lottie-neon-glow");
      }
    }

    onCleanup(() => {
      if (anim) {
        anim.destroy();
      }
    });
  });

  return <div ref={containerRef} style={props.style} class={props.className} />;
};
