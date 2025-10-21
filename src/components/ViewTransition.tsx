import { onMount, createSignal, on, Show } from "solid-js";
import { useNavigate, useLocation } from "@solidjs/router";

declare global {
  interface Document {
    createDocumentTransition?: (options: any) => any;
  }
}

// Simple ViewTransition component for page transitions
export const ViewTransition = (props: { children: any }) => {
  const [isTransitioning, setIsTransitioning] = createSignal(false);
  const location = useLocation();
  // Check if View Transitions API is supported
  const viewTransitionsSupported = () => {
    return (
      !!document.startViewTransition || !!document.createDocumentTransition
    );
  };
  // Apply transition effect if supported
  const applyTransition = (element: HTMLDivElement) => {
    if (element && viewTransitionsSupported()) {
      // Add a class to enable transitions
      element.classList.add("view-transition-container");
      // Listen for navigation changes
      const cleanup = () => {
        if (element) {
          element.classList.remove("view-transition-container");
        }
      };
      return cleanup;
    }
  };
  return (
    <div ref={applyTransition} class="view-transition-container">
      {" "}
      {props.children}{" "}
    </div>
  );
};
