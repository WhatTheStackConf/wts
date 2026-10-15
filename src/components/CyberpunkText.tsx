import { createSignal, onSettled, Show } from "solid-js";
import { typeText } from "./typewriter";

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

  const twoLines = () => props.isWhatTheStack && props.firstLineText && props.secondLineText;
  const showEffectSoon = () => setTimeout(() => {
    setShowEffect(true);
    props.onTypingComplete?.();
  }, 1000);

  onSettled(() => {
    const startDelay = props.delay || 0;
    if (props.disabled) {
      return;
    }

    if (twoLines()) {
      setTimeout(() => {
        typeText(props.firstLineText!, setDisplayText, () => {
          // Pause briefly between the first and second lines.
          setTimeout(() => {
            setIsTypingFirst(false);
            setDisplayText("");
            typeText(props.secondLineText!, setDisplayText, showEffectSoon);
          }, 500);
        });
      }, startDelay);
    } else {
      setTimeout(() => {
        typeText(props.text, setDisplayText, () => {
          // Keep the typing indicator visible even after typing completes
          setTypingIndicator(true);
          showEffectSoon();
        });
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

  const cursor = () => <span class="ml-0.5 inline-block w-1 h-6 bg-current align-middle animate-pulse"></span>;

  const renderLines = () => (
    <div class="flex flex-col">
      <div>
        {isTypingFirst() ? renderWhatTheStackText() : props.firstLineText}
        {isTypingFirst() && typingIndicator() && cursor()}
      </div>
      {!isTypingFirst() && (
        <div class="mt-2">
          {" "}
          {/* Add some space between lines */}
          {displayText()}
          {typingIndicator() && !isTypingFirst() && cursor()}
        </div>
      )}
    </div>
  );

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
        {twoLines() ? renderLines() : props.isYear ? (
          <>
            {renderYearText()}
            {typingIndicator() && cursor()}
          </>
        ) : (
          <>
            {displayText()}
            {typingIndicator() && cursor()}
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
