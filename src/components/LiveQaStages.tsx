import { useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { loadLiveQaProgramme } from "~/lib/live-qa-client";
import type { LiveQaProgrammeSession } from "~/lib/live-qa-contract";
import { createAsyncResource as createResource } from "~/lib/async-resource";

interface LiveQaStagesProps { moderation?: boolean }

const sessionTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Skopje", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function talkStatus(session: LiveQaProgrammeSession, serverNow: string | undefined, verified: boolean) {
  const now = Date.parse(serverNow ?? "");
  const start = Date.parse(session.startAt);
  const end = Date.parse(session.endAt);
  if (!verified || !Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { label: "Question availability unverified", highlighted: false, accepting: false, finished: false };
  }
  const finished = now >= end;
  const current = now >= start && now < end;
  const timing = finished ? "Finished" : current ? "Scheduled now" : "Upcoming";
  const availability = session.accepting ? "Questions open"
    : session.mode === "closed" || finished ? "Questions closed" : "Questions not open yet";
  return {
    label: `${timing} · ${availability}`,
    highlighted: current || session.accepting,
    accepting: session.accepting,
    finished,
  };
}

/** Public programme metadata only. Question queues remain inside the session's authority gate. */
export function LiveQaStages(props: LiveQaStagesProps) {
  const [params, setParams] = useSearchParams();
  const [mounted, setMounted] = createSignal(false);
  const [error, setError] = createSignal("");
  const [search, setSearch] = createSignal("");
  let alive = true;
  let inFlight = false;
  const [programme, controls] = createResource(mounted, async () => {
    inFlight = true;
    try {
      const result = await loadLiveQaProgramme();
      if (alive) setError("");
      return result;
    } catch (cause) {
      // The resource clears its error on retry. Keep availability unverified
      // separately until an actual successful refresh, not merely its start.
      if (alive) setError("Couldn't refresh the main-day programme. Question availability is unverified. Refresh to try again.");
      throw cause;
    } finally { inFlight = false; }
  });
  const loading = () => programme.loading;

  const selectedStage = createMemo(() => {
    const stages = programme()?.stages ?? [];
    return stages.find((stage) => stage.key === params.stage) ?? stages[0];
  });
  const unknownStage = createMemo(() => params.stage !== undefined
    && !!programme()?.stages.length
    && !programme()?.stages.some((stage) => stage.key === params.stage));
  const sessions = createMemo(() => {
    const query = search().trim().toLocaleLowerCase();
    return (selectedStage()?.sessions ?? []).filter((session) => session.title.toLocaleLowerCase().includes(query));
  });

  async function refresh() {
    if (!alive || !mounted() || inFlight || programme.loading) return;
    try { await controls.refetch(); } catch { /* The loader retains the visible warning. */ }
  }

  onCleanup(() => { alive = false; });
  onSettled(() => {
    if (typeof window === "undefined") return;
    setMounted(true);
    const poll = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  });

  return (
    <section class="glass-panel min-w-0 rounded-2xl p-4 sm:p-6 md:p-8 space-y-6" aria-labelledby="qa-stage-heading">
      <header class="space-y-3">
        <h2 id="qa-stage-heading" class="font-star text-2xl md:text-3xl text-secondary-400">Choose your stage</h2>
        <p class="text-primary-200">Live Q&A is for the main conference day only.</p>
        <Show when={programme()?.day}>
          {(day) => <p class="font-mono text-sm text-secondary-200 break-words">
            {day().title} · <time datetime={day().localDate}>{day().localDate}</time> · All times Europe/Skopje (24-hour).
          </p>}
        </Show>
        <Show when={props.moderation} fallback={
          <p class="text-sm text-primary-200">Browse talks without logging in. Log in to submit a question. Questions are visible only to their author, MCs and administrators.</p>
        }>
          <p class="text-sm text-primary-200">Choose a talk to view its question queue and MC controls. Questions are visible only to their author, MCs and administrators.</p>
        </Show>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn btn-outline min-h-12" disabled={loading()} onClick={() => { void refresh(); }}>Refresh sessions</button>
          <p class="text-sm text-primary-200">Refreshes every 15 seconds while visible.</p>
        </div>
      </header>
      <Show when={error()}><p role="alert" class="alert alert-warning break-words">{error()}</p></Show>
      <Show when={loading()}><p role="status">Refreshing main-day sessions…</p></Show>
      <Show when={programme()}>
        {(data) => <>
          <Show when={data().day} fallback={<p role="status">The main-day Q&A programme is not published yet.</p>}>
            <Show when={data().stages.length} fallback={<p>No stages are published for the main conference day yet.</p>}>
              <div role="group" aria-label="Conference stages" class="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <For each={data().stages}>
                  {(stage) => <button
                    type="button"
                    aria-pressed={selectedStage()?.key === stage.key ? "true" : "false"}
                    class={`btn min-h-12 h-auto min-w-0 whitespace-normal break-words px-3 py-3 ${selectedStage()?.key === stage.key ? "btn-primary" : "btn-outline"}`}
                    onClick={() => { setSearch(""); setParams({ stage: stage.key }, { replace: false, scroll: false }); }}
                  >{stage.name}</button>}
                </For>
              </div>
              <Show when={unknownStage()}>
                <p role="status" class="text-sm text-primary-200">That stage is unavailable. Showing {selectedStage()?.name} instead. Choose a stage above.</p>
              </Show>
              <Show when={selectedStage()}>
                {(stage) => <section aria-labelledby="qa-selected-stage" class="min-w-0 space-y-4">
                  <header class="space-y-1">
                    <h3 id="qa-selected-stage" class="text-xl font-bold text-white break-words">{stage().name}</h3>
                    <Show when={stage().locationLabel}><p class="text-primary-200 break-words">{stage().locationLabel}</p></Show>
                  </header>
                  <Show when={stage().sessions.length} fallback={<p>No talks or questions are scheduled for this stage yet.</p>}>
                    <div class="space-y-2">
                      <label for="qa-session-search" class="block font-bold text-white">Search sessions in this stage</label>
                      <input id="qa-session-search" type="search" class="input input-bordered min-h-12 w-full min-w-0" value={search()} onInput={(event) => { setSearch(event.currentTarget.value); }} />
                    </div>
                    <Show when={sessions().length} fallback={<p>No talks in this stage match your search.</p>}>
                      <ul class="space-y-3 list-none p-0 min-w-0">
                        <For each={sessions()}>
                          {(session) => {
                            const status = createMemo(() => talkStatus(session, programme()?.serverNow, !error()));
                            const action = createMemo(() => props.moderation ? "View question queue"
                              : status().accepting ? "Ask a question" : status().finished ? "View your questions" : "View talk");
                            return <li class={`rounded-xl border p-4 space-y-3 min-w-0 ${status().highlighted ? "border-primary-400 bg-primary-400/10" : "border-white/15"}`}>
                              <p class="font-mono text-sm text-secondary-200">
                                <time datetime={session.startAt}>{sessionTime.format(new Date(session.startAt))}</time>–<time datetime={session.endAt}>{sessionTime.format(new Date(session.endAt))}</time>
                              </p>
                              <h4 class="font-bold text-white break-words">{session.title}</h4>
                              <p class={`text-sm ${status().highlighted ? "font-bold text-secondary-300" : "text-primary-200"}`}>{status().label}</p>
                              <a href={`/sessions/${encodeURIComponent(session.slug)}#live-qa`} class="btn btn-outline min-h-12 h-auto whitespace-normal py-3 max-w-full" aria-label={`${action()}: ${session.title}`}>{action()}</a>
                            </li>;
                          }}
                        </For>
                      </ul>
                    </Show>
                  </Show>
                </section>}
              </Show>
            </Show>
          </Show>
          <a href={data().day ? `/agenda?day=${encodeURIComponent(data().day!.localDate)}` : "/agenda"} class="inline-flex min-h-12 items-center underline underline-offset-4 text-secondary-300">View full agenda</a>
        </>}
      </Show>
    </section>
  );
}

export default LiveQaStages;
