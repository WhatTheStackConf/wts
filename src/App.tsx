import { Loading, createSignal, onSettled } from "solid-js";
import { isServer } from "@solidjs/web";
import { AuthProvider } from "~/lib/auth-context";
import { initPocketBase } from "~/lib/pocketbase-utils";
import { Router } from "~/router";
// Client-only protected routes still call these server references after
// hydration. Preload the modules in the SSR graph so the dev server registers
// their implementations before an RPC arrives.
import "~/lib/admin-actions";
import "~/lib/reviewer-actions";
import "~/lib/programme-admin-actions";
import "~/lib/partner-administration-actions";
import "~/lib/mcp-actions";
import "~/lib/gamification-operations-actions";
import "~/lib/gamification-admin-actions";
import "~/lib/gamification-hievents-actions";
import "~/lib/partner-contact-consent-actions";
import "~/lib/profile-actions";
import "~/lib/cfp-actions";
import "./styles/app.css";

initPocketBase();

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

export default function App() {
  return (
    <Router>
      {(props) => (
        <AuthProvider>
          <div class="view-transition-container isolate relative min-h-screen">
            <DeferredBackground />
            <div class="relative z-10">
              <Loading fallback={<div>Loading...</div>}>{props.children}</Loading>
            </div>
          </div>
        </AuthProvider>
      )}
    </Router>
  );
}
