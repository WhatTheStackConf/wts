import { createSignal, onMount, Show } from "solid-js";

interface MultiLineCyberpunkTextProps {
  firstLineText: string;
  secondLineText: string;
  className?: string;
  hasGlow?: boolean;
  delay?: number;
  tracking?: string;
  trackingYear?: string;
}

const MultiLineCyberpunkText = (props: MultiLineCyberpunkTextProps) => {
  const [displayText, setDisplayText] = createSignal("");
  const [typingIndicator, setTypingIndicator] = createSignal(true);
  const [showEffect, setShowEffect] = createSignal(false);
  const [isTypingFirst, setIsTypingFirst] = createSignal(true); // true for typing first text, false for second text

  const shouldAnimate = sessionStorage.getItem("shouldAnimate") !== "false";

  onMount(() => {
    // Delay before typing starts
    const startDelay = props.delay || 0;

    setTimeout(() => {
      // Start typing the first text
      let i = 0;
      const firstText = props.firstLineText;
      const typingSpeed = 150; // Consistent speed for all text

      const typeInterval = setInterval(() => {
        if (i < firstText.length) {
          setDisplayText(firstText.slice(0, i + 1));
          i++;
        } else {
          clearInterval(typeInterval);

          // After first text is fully typed, pause briefly then start typing second text
          setTimeout(() => {
            setIsTypingFirst(false);
            setDisplayText(""); // Reset display text for the second line

            let j = 0;
            const secondText = props.secondLineText;

            const secondTypeInterval = setInterval(() => {
              if (j < secondText.length) {
                setDisplayText(secondText.slice(0, j + 1));
                j++;
              } else {
                clearInterval(secondTypeInterval);

                // After all typing is done, show effects
                setTimeout(() => {
                  setShowEffect(true);
                }, 1000);
              }
            }, typingSpeed);
          }, 500); // Delay before starting second line
        }
      }, typingSpeed);
    }, startDelay);
  });

  // Function to render WhatTheStack text with specific colors
  const renderWhatTheStackText = () => {
    const fullText = displayText();

    // Split the text into segments for the first line
    const whatEnd = Math.min(fullText.length, 4); // "What"
    const theEnd = Math.min(fullText.length, 7); // "WhatThe"
    const stackEnd = fullText.length; // Rest of text

    return (
      <>
        {/* "What" - yellow/secondary color */}
        <span class="text-secondary-300">{fullText.substring(0, whatEnd)}</span>
        {/* "The" - magenta/primary color */}
        <span class="text-primary-500">
          {fullText.substring(whatEnd, theEnd)}
        </span>
        {/* "Stack" - yellow/secondary color */}
        <span class="text-secondary-300">
          {fullText.substring(theEnd, stackEnd)}
        </span>
      </>
    );
  };

  return (
    <>
      <Show when={shouldAnimate}>
        <div class={`flex flex-col ${props.className} relative leading-none`}>
          <div>
            {isTypingFirst() ? (
              <span
                class={`relative ${props.hasGlow ? "neon-glow-subtle" : ""}`}
              >
                {renderWhatTheStackText()}
                {typingIndicator() && (
                  <span class="ml-0.5 inline-block w-1 h-3 md:h-6 bg-primary-500 align-middle animate-pulse"></span>
                )}
              </span>
            ) : (
              <span
                class={`relative ${props.hasGlow ? "neon-glow-subtle" : ""}`}
              >
                <span class="text-secondary-300">What</span>
                <span class="text-primary-500">The</span>
                <span class="text-secondary-300">Stack</span>
              </span>
            )}
          </div>
          <div class="mt-0 md:mt-2">
            {!isTypingFirst() && (
              <span
                class={`relative ${props.hasGlow ? "neon-glow-subtle" : ""} whitespace-nowrap`}
              >
                <span
                  class={`text-primary-400 text-xs md:text-2xl ${props.trackingYear || "tracking-[1em]"}`}
                >
                  {displayText().split("").join(" ")}
                </span>
                {typingIndicator() && !isTypingFirst() && (
                  <span class="ml-0.5 inline-block w-1 h-3 md:h-6 bg-primary-500 align-middle animate-pulse"></span>
                )}
              </span>
            )}
          </div>

          {/* Subtle glitch effect for the entire text */}
          <Show when={showEffect()}>
            <span
              class={`absolute top-0 left-0 overflow-hidden pointer-events-none opacity-50 flex flex-col`}
              style={{ color: "#fc00ff" }}
            >
              <span class="animate-subtle-glitch" data-text="WhatTheStack">
                WhatTheStack
              </span>
            </span>
          </Show>
        </div>
      </Show>
      <Show when={!shouldAnimate}>
        <div class={`flex flex-col ${props.className} relative leading-none`}>
          <div>
            <span class={`relative ${props.hasGlow ? "neon-glow-subtle" : ""}`}>
              <span class="text-secondary-300">What</span>
              <span class="text-primary-500">The</span>
              <span class="text-secondary-300">Stack</span>
            </span>

            <div class="mt-0 md:mt-2">
              <span class="relative neon-glow-subtle whitespace-nowrap">
                <span class={`text-primary-400 text-xs md:text-2xl ${props.trackingYear || "tracking-[0.7em]"}`}>
                  2 0 2 6
                </span>
                <span class="ml-0.5 inline-block w-1 h-3 md:h-6 bg-primary-500 align-middle animate-pulse"></span>
              </span>
            </div>
          </div>
          <Show when={showEffect()}>
            <span
              class={`absolute top-0 left-0 overflow-hidden pointer-events-none opacity-50 flex flex-col`}
              style={{ color: "#fc00ff" }}
            >
              <span class="animate-subtle-glitch" data-text="WhatTheStack">
                WhatTheStack
              </span>
            </span>
          </Show>
        </div>
      </Show>
    </>
  );
};

export default MultiLineCyberpunkText;
