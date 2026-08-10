import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createSignal, onCleanup, onMount, Suspense } from "solid-js";
import "./styles/app.css";
import { initPocketBase } from "~/lib/pocketbase-utils";
import { AuthProvider } from "~/lib/auth-context";

// Initialize PocketBase when the app starts
initPocketBase();

function DeferredBackground() {
  const [source, setSource] = createSignal<string>();
  const [visible, setVisible] = createSignal(false);
  let loadFrame: number | undefined;
  let revealFrame: number | undefined;
  let disposed = false;

  onMount(() => {
    const requestBackground = () => {
      loadFrame = window.requestAnimationFrame(() => setSource("/bg.webp"));
    };

    if (document.readyState === "complete") {
      requestBackground();
    } else {
      window.addEventListener("load", requestBackground, { once: true });
    }

    onCleanup(() => {
      disposed = true;
      window.removeEventListener("load", requestBackground);
      if (loadFrame !== undefined) window.cancelAnimationFrame(loadFrame);
      if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
    });
  });

  return (
    <img
      src={source()}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      fetchpriority="low"
      width="1024"
      height="585"
      class="pointer-events-none fixed inset-0 z-0 h-full w-full select-none object-cover opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      classList={{ "opacity-100": visible() }}
      onLoad={(event) => {
        const image = event.currentTarget;
        void image.decode().catch(() => undefined).then(() => {
          if (disposed) return;
          revealFrame = window.requestAnimationFrame(() => setVisible(true));
        });
      }}
    />
  );
}

export default function App() {
  return (
    <>
      <Router
        root={(props) => (
          <MetaProvider>
            <AuthProvider>
              <div class="view-transition-container isolate relative min-h-screen">
                <DeferredBackground />
                <div class="relative z-10">
                  <Suspense>{props.children}</Suspense>
                </div>
              </div>
            </AuthProvider>
          </MetaProvider>
        )}
      >
        <Suspense fallback={<div>Loading...</div>}>
          <FileRoutes />
        </Suspense>
      </Router>
    </>
  );
}
