import {
  createSignal,
  createContext,
  useContext,
} from "solid-js";

declare global {
  interface Document {
    createDocumentTransition?: (options: any) => any;
    // startViewTransition?: (
    //   callbackOptions?: ViewTransitionUpdateCallback | undefined,
    // ) => ViewTransition;
  }
}

// Context for view transitions
interface ViewTransitionContextValue {
  startTransition: (callback: () => void) => void;
  isTransitioning: () => boolean;
}

const ViewTransitionContext = createContext<ViewTransitionContextValue>();

export const ViewTransitionProvider = (props: { children: any }) => {
  const [isTransitioning, setIsTransitioning] = createSignal(false);

  const startTransition = (callback: () => void) => {
    if ((document as any).startViewTransition) {
      setIsTransitioning(true);
      (document as any)
        .startViewTransition(() => {
          callback();
        })
        .finally(() => {
          setIsTransitioning(false);
        });
    } else {
      // Fallback for browsers that don't support View Transitions API
      callback();
    }
  };

  const value = {
    startTransition,
    isTransitioning,
  };

  return (
    <ViewTransitionContext value={value}>
      {props.children}
    </ViewTransitionContext>
  );
};

export const useViewTransition = () => {
  const context = useContext(ViewTransitionContext);
  if (!context) {
    throw new Error(
      "useViewTransition must be used within a ViewTransitionProvider",
    );
  }
  return context;
};
