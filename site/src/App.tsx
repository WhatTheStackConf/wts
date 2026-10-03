import { Loading, createSignal, onSettled, type ParentProps } from "solid-js";
import { isServer } from "@solidjs/web";
import { initializeServerFunctionTransport } from "~/lib/server-function-transport";
import { Router } from "~/router";
import "./styles/app.css";
import "./styles/public-support.css";
import "./styles/public-links.css";
import "./styles/public-header.css";

if (!isServer) initializeServerFunctionTransport();

function DeferredBackground() {
  const [source, setSource] = createSignal<string>();
  const [visible, setVisible] = createSignal(false);
  let loadFrame: number | undefined;
  let revealFrame: number | undefined;
  let disposed = false;

  onSettled(() => {
    if (isServer) return;
    const requestBackground = () => {
      loadFrame = window.requestAnimationFrame(() => setSource("/bg.webp"));
    };

    if (document.readyState === "complete") requestBackground();
    else window.addEventListener("load", requestBackground, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", requestBackground);
      if (loadFrame !== undefined) window.cancelAnimationFrame(loadFrame);
      if (revealFrame !== undefined) window.cancelAnimationFrame(revealFrame);
    };
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
      class={[
        "pointer-events-none fixed inset-0 z-0 h-full w-full select-none object-cover opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        { "opacity-100": visible() },
      ]}
      onLoad={(event) => {
        const image = event.currentTarget;
        void image
          .decode()
          .catch(() => undefined)
          .then(() => {
            if (disposed) return;
            revealFrame = window.requestAnimationFrame(() => setVisible(true));
          });
      }}
    />
  );
}

function ApplicationShell(props: ParentProps) {
  return (
    <div class="view-transition-container isolate relative min-h-screen">
      <DeferredBackground />
      <div class="relative z-10">
        <Loading fallback={<div role="status">Loading...</div>}>{props.children}</Loading>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      {(props) => <ApplicationShell>{props.children}</ApplicationShell>}
    </Router>
  );
}
