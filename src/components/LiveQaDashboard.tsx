import { createMemo, Show } from "solid-js";
import { LiveQaStages } from "~/components/LiveQaStages";
import { useAuth } from "~/lib/auth-context";
import { mcAuthorized } from "~/lib/route-authorization";

export function LiveQaDashboard() {
  const auth = useAuth();
  const scope = createMemo(() => mcAuthorized({ loading: auth.isLoading(), authenticated: auth.isAuthenticated(), role: auth.user?.role })
    ? JSON.stringify([auth.user?.id, auth.user?.role]) : undefined);
  return (
    <Show when={!auth.isLoading()} fallback={<p role="status">Checking MC access…</p>}>
      <Show when={scope()} keyed fallback={
        <div class="glass-panel rounded-2xl p-6 space-y-4">
          <p role="alert">This dashboard is only available to MCs and administrators.</p>
          <Show when={!auth.isAuthenticated()}>
            <a href="/login?redirect_url=%2Fmc" class="btn btn-primary min-h-12" onClick={() => { try { localStorage.setItem("redirect_url", "/mc"); } catch { /* Login remains available without storage. */ } }}>Log in</a>
          </Show>
        </div>
      }>
        {(_key) => <LiveQaStages moderation />}
      </Show>
    </Show>
  );
}

export default LiveQaDashboard;
