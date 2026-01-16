import { createSignal, onMount } from "solid-js";

interface AlternativelyTypingProps {
  alternatives: string[];
}

export default function AlternativelyTyping(props: AlternativelyTypingProps) {
  const [currentText, setCurrentText] = createSignal("");
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [typingSpeed, setTypingSpeed] = createSignal(100);

  const alternatives = props.alternatives;

  onMount(() => {
    const type = () => {
      const currentAlternative = alternatives[currentIndex()];
      const fullText = currentAlternative;

      if (isDeleting()) {
        setCurrentText(fullText.substring(0, currentText().length - 1));
        setTypingSpeed(50);
      } else {
        setCurrentText(fullText.substring(0, currentText().length + 1));
        setTypingSpeed(100);
      }

      if (!isDeleting() && currentText() === fullText) {
        // Pause at the end of typing before starting to delete
        setTimeout(() => {
          setIsDeleting(true);
        }, 1000);
      } else if (isDeleting() && currentText() === "") {
        // Move to next alternative after deleting
        setIsDeleting(false);
        setCurrentIndex((currentIndex() + 1) % alternatives.length);
      }

      setTimeout(type, typingSpeed());
    };

    // Start the typing after a small delay
    setTimeout(type, 500);
  });

  return <span class="text-primary-600 font-bold">{currentText() || "\u00A0"}</span>;
}
