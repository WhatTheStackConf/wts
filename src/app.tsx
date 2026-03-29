import { MetaProvider } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import "./styles/app.css";
import { initPocketBase } from "~/lib/pocketbase-utils";
import { AuthProvider } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";

// Initialize PocketBase when the app starts
initPocketBase();

export default function App() {
  return (
    <>
      <Router
        root={(props) => (
          <MetaProvider>
            <AuthProvider>
              <div class="view-transition-container">
                <Suspense>{props.children}</Suspense>
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
