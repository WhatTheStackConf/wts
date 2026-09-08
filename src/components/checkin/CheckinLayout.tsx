import { Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Title, Meta } from "@solidjs/meta";
import { useAuth } from "~/lib/auth-context";

interface CheckinLayoutProps { title: string; children: JSX.Element }
/** Operational surfaces intentionally omit marketing, newsletter and telemetry UI. */
export function CheckinLayout(props: CheckinLayoutProps) {
  const auth = useAuth();
  const [loggingOut, setLoggingOut] = createSignal(false);
  const [error, setError] = createSignal("");
  async function logout() {
    if (loggingOut()) return;
    setLoggingOut(true);
    try {
      await auth.logout();
      window.location.assign("/login");
    } catch {
      setError("Logout failed. Retry before handing over this phone.");
      setLoggingOut(false);
    }
  }
  return (
    <div class="min-h-screen bg-base-300 text-base-content">
      <Title>{props.title} | WTS 2026</Title>
      <Meta name="robots" content="noindex,nofollow" />
      <Meta name="referrer" content="no-referrer" />
      <header class="border-b border-base-content/20 px-4 py-4">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <a href="/checkin" target="_self" class="font-mono text-lg font-bold">WTS 2026 / CHECK-IN</a>
          <nav aria-label="Check-in navigation" class="flex flex-wrap items-center gap-3">
            <Show when={auth.user?.role === "admin"}>
              <a href="/admin/checkin" target="_self" class="btn btn-outline min-h-12">Station administration</a>
              <a href="/admin/users" target="_self" class="btn btn-ghost min-h-12">User roles</a>
            </Show>
            <button type="button" class="btn btn-outline min-h-12" disabled={loggingOut()} onClick={() => void logout()}>Log out</button>
          </nav>
        </div>
      </header>
      <main class="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <h1 class="text-3xl font-bold">{props.title}</h1>
        <p class="text-sm opacity-80">Signed in as {auth.user?.name || "User"}. Binding belongs to this browser, not this login.</p>
        <Show when={error()}><p role="alert" class="alert alert-error">{error()}</p></Show>
        {props.children}
      </main>
    </div>
  );
}
