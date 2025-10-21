import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./styles/app.css";
import { initPocketBase } from "~/lib/pocketbase-utils";

// Initialize PocketBase when the app starts
initPocketBase();

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <div class="view-transition-container">
            <Suspense>{props.children}</Suspense>
          </div>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
