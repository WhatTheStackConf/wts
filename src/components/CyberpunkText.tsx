import { createSignal, onMount, Show } from "solid-js";

interface CyberpunkTextProps {
  text: string;
  className?: string;
  hasGlow?: boolean; // Whether to add neon glow
  delay?: number; // Delay before typing starts
  isWhatTheStack?: boolean; // Special handling for WhatTheStack text
  isYear?: boolean; // Special handling for year text
  tracking?: string; // External tracking class
  firstLineText?: string; // For multi-line typing - first line
  secondLineText?: string; // For multi-line typing - second line
  onTypingComplete?: () => void; // Callback when typing completes
  disabled?: boolean; // Whether component is disabled
}

export const CyberpunkText = (props: CyberpunkTextProps) => {
  const [displayText, setDisplayText] = createSignal("");
  const [typingIndicator, setTypingIndicator] = createSignal(true);
  const [showEffect, setShowEffect] = createSignal(false);
  const [isTypingFirst, setIsTypingFirst] = createSignal(true); // true for typing first text, false for second text

  onMount(() => {
    // Delay before typing starts
    const startDelay = props.delay || 0;

    // Don't start typing if component is disabled
    if (props.disabled) {
      return;
    }

    // Check if we are handling multi-line typing
    if (props.isWhatTheStack && props.firstLineText && props.secondLineText) {
      setTimeout(() => {
        // Start typing the first text
        let i = 0;
        const firstText = props.firstLineText!;
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
              const secondText = props.secondLineText!;

              const secondTypeInterval = setInterval(() => {
                if (j < secondText.length) {
                  setDisplayText(secondText.slice(0, j + 1));
                  j++;
                } else {
                  clearInterval(secondTypeInterval);

                  // After all typing is done, show effects
                  setTimeout(() => {
                    setShowEffect(true);
                    // Call the completion callback if provided
                    if (props.onTypingComplete) {
                      props.onTypingComplete();
                    }
                  }, 1000);
                }
              }, typingSpeed);
            }, 500); // Delay before starting second line
          }
        }, typingSpeed);
      }, startDelay);
    } else {
      // Handle single line typing as before
      setTimeout(() => {
        let i = 0;
        const text = props.text;
        const typingSpeed = 150; // Consistent speed for all text

        const typeInterval = setInterval(() => {
          if (i < text.length) {
            setDisplayText(text.slice(0, i + 1));
            i++;
          } else {
            clearInterval(typeInterval);
            // Keep the typing indicator visible even after typing completes
            setTypingIndicator(true);

            // After typing is complete, start effects after a delay
            setTimeout(() => {
              setShowEffect(true);
              // Call the completion callback if provided
              if (props.onTypingComplete) {
                props.onTypingComplete();
              }
            }, 1000); // Delay before effects start
          }
        }, typingSpeed);
      }, startDelay);
    }
  });

  // Function to render WhatTheStack text with specific colors
  const renderWhatTheStackText = () => {
    const fullText = displayText();

    if (props.isWhatTheStack && props.firstLineText) {
      // Split the text into segments for the first line
      const whatEnd = Math.min(fullText.length, 4); // "What"
      const theEnd = Math.min(fullText.length, 7); // "WhatThe"
      const stackEnd = fullText.length; // Rest of text

      return (
        <>
          {/* "What" - yellow/secondary color */}
          <span class="text-secondary-300">
            {fullText.substring(0, whatEnd)}
          </span>
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
    } else {
      return displayText();
    }
  };

  // Function to render year text with specific color and external tracking
  const renderYearText = () => {
    return (
      <span class={`text-primary-500 ${props.tracking}`}>
        {displayText().split("").join(" ")}
      </span>
    );
  };

  return (
    <span class={`relative ${props.className || ""}`}>
      <span class={`relative ${props.hasGlow ? "neon-glow-subtle" : ""}`}>
        {props.isWhatTheStack && props.firstLineText && props.secondLineText ? (
          <div class="flex flex-col">
            <div>
              {isTypingFirst() ? renderWhatTheStackText() : props.firstLineText}
              {isTypingFirst() && typingIndicator() && (
                <span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span>
              )}
            </div>
            {!isTypingFirst() && (
              <div class="mt-2">
                {" "}
                {/* Add some space between lines */}
                {displayText()}
                {typingIndicator() && !isTypingFirst() && (
                  <span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span>
                )}
              </div>
            )}
          </div>
        ) : props.isYear ? (
          <>
            {renderYearText()}
            {typingIndicator() && (
              <span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span>
            )}
          </>
        ) : (
          <>
            {displayText()}
            {typingIndicator() && (
              <span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span>
            )}
          </>
        )}
      </span>

      {/* Subtle glitch effect for the entire text */}
      <Show when={showEffect()}>
        <span
          class={`absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-50 ${props.tracking}`}
          style={{ color: props.isYear ? "#00fffc" : "#fc00ff" }}
        >
          <span class="animate-subtle-glitch" data-text={props.text}>
            {props.text}
          </span>
        </span>
      </Show>
    </span>
  );
};
