import { createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { LiveQaClientError, liveQaRequest } from "~/lib/live-qa-client";
import type { LiveQaCatalogue } from "~/lib/live-qa-contract";
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
        {(key) => <PrivateCatalogue actorId={auth.user!.id} current={() => scope() === key} />}
      </Show>
    </Show>
  );
}

interface PrivateCatalogueProps { actorId: string; current: () => boolean }
function PrivateCatalogue(props: PrivateCatalogueProps) {
  const actorId = props.actorId;
  const [catalogue, setCatalogue] = createSignal<LiveQaCatalogue>();
  const [draft, setDraft] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let alive = true;
  let epoch = 0;
  let inFlight = false;
  let selectedPage = 1;
  let selectedSearch = "";
  const current = () => alive && props.current();

  async function refresh(page = selectedPage, query = selectedSearch) {
    if (!current() || inFlight) return;
    inFlight = true;
    const version = ++epoch;
    setLoading(true);
    // Search intent is captured separately from edits and periodic observations.
    selectedPage = page;
    selectedSearch = query;
    setSearch(query);
    try {
      const result = await liveQaRequest<LiveQaCatalogue>({ operation: "catalogue", page, search: query }, actorId);
      if (!current() || version !== epoch) return;
      if (!result || result.page !== page || !Number.isInteger(result.totalPages) || result.totalPages < 0
        || !Array.isArray(result.items) || result.items.length > 50
        || !result.items.every((item) => item && typeof item.slug === "string" && item.slug.length > 0 && typeof item.title === "string")) {
        throw new Error("Invalid session catalogue");
      }
      setCatalogue(result);
      setError("");
    } catch (cause) {
      if (!current() || version !== epoch) return;
      setCatalogue(undefined);
      if (cause instanceof LiveQaClientError && (cause.status === 401 || cause.status === 403)) {
        setDraft("");
        setSearch("");
        selectedSearch = "";
        selectedPage = 1;
        setError("MC access could not be verified. Log in again or refresh to check access.");
      } else {
        setError("Couldn't load published sessions. Please refresh to try again.");
      }
    } finally {
      inFlight = false;
      if (current()) setLoading(false);
    }
  }

  onCleanup(() => { alive = false; epoch++; });
  onSettled(() => {
    if (typeof window === "undefined") return;
    void refresh();
    const poll = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  });

  return (
    <div class="glass-panel rounded-2xl p-6 md:p-8 space-y-6">
      <p>Choose a published session to read private questions, mark answers, or adjust question timing for delays.</p>
      <form class="space-y-3" onSubmit={(event) => { event.preventDefault(); void refresh(1, draft().trim()); }}>
        <label for="mc-session-search" class="block font-bold text-white">Search published sessions</label>
        <div class="flex flex-col sm:flex-row gap-3">
          <input id="mc-session-search" type="search" class="input input-bordered min-h-12 w-full min-w-0" value={draft()} onInput={(event) => { setDraft(event.currentTarget.value); }} />
          <button type="submit" class="btn btn-primary min-h-12" disabled={loading()}>Search sessions</button>
          <button type="button" class="btn btn-outline min-h-12" disabled={loading()} onClick={() => void refresh()}>Refresh sessions</button>
        </div>
      </form>
      <Show when={error()}><p role="alert" class="alert alert-warning">{error()}</p></Show>
      <Show when={loading() && !catalogue() && !error()}><p role="status">Loading published sessions…</p></Show>
      <Show when={catalogue()}>
        {(data) => <div class="space-y-4">
          <p class="text-sm text-primary-200">Published sessions · Up to 50 per page · Refreshes every 5 seconds while visible.</p>
          <Show when={search()}><p>Results for “{search()}”</p></Show>
          <Show when={data().items.length} fallback={<p>No published sessions match this search.</p>}>
            <ul class="space-y-3 list-none p-0">
              <For each={data().items}>
                {(item) => <li>
                  <a href={`/sessions/${encodeURIComponent(item.slug)}#live-qa`} class="block rounded-xl border border-white/15 p-4 min-h-12 hover:border-primary-400 focus-visible:outline-2 focus-visible:outline-primary-400">
                    <span class="block font-bold text-white break-words">{item.title}</span>
                    <span class="block text-sm text-primary-200 mt-1">View questions & MC controls</span>
                  </a>
                </li>}
              </For>
            </ul>
          </Show>
          <nav aria-label="Session pages" class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-outline min-h-12" disabled={loading() || data().page <= 1} onClick={() => void refresh(data().page - 1)}>Previous sessions</button>
            <span>Page {data().page} of {Math.max(1, data().totalPages)}</span>
            <button type="button" class="btn btn-outline min-h-12" disabled={loading() || data().page >= data().totalPages} onClick={() => void refresh(data().page + 1)}>Next sessions</button>
          </nav>
        </div>}
      </Show>
    </div>
  );
}

export default LiveQaDashboard;
