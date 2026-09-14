import { createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { LiveQaClientError, liveQaRequest, loadLiveQaProgramme } from "~/lib/live-qa-client";
import { createAsyncResource as createResource } from "~/lib/async-resource";
import type { LiveQaMode, LiveQaQuestion, LiveQaRequest, LiveQaSession } from "~/lib/live-qa-contract";

interface LiveQaPanelProps { slug: string }
type AskCommand = Extract<LiveQaRequest, { operation: "ask" }>;

function validQuestion(value: unknown): value is LiveQaQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as LiveQaQuestion;
  return typeof question.id === "string" && question.id.length > 0
    && typeof question.body === "string" && typeof question.answered === "boolean"
    && typeof question.own === "boolean" && typeof question.created === "string"
    && Number.isFinite(Date.parse(question.created));
}

function validSession(value: LiveQaSession, slug: string, page: number): boolean {
  return !!value && value.slug === slug && typeof value.sessionId === "string"
    && typeof value.accepting === "boolean" && typeof value.canModerate === "boolean"
    && ["auto", "open", "closed"].includes(value.mode)
    && Number.isFinite(Date.parse(value.serverNow))
    && (value.startAt === null || Number.isFinite(Date.parse(value.startAt)))
    && (value.endAt === null || Number.isFinite(Date.parse(value.endAt)))
    && value.page === page && Number.isInteger(value.totalPages) && value.totalPages >= 0
    && Array.isArray(value.questions) && value.questions.length <= 50
    && value.questions.every(validQuestion);
}

function loginRedirect() {
  try {
    localStorage.setItem("redirect_url", `${location.pathname}${location.search}#live-qa`);
  } catch {
    // A blocked browser store must not prevent opening the login page.
  }
}

export function LiveQaPanel(props: LiveQaPanelProps) {
  const auth = useAuth();
  const directory = () => auth.user?.role === "mc" || auth.user?.role === "admin" ? "/mc" : "/qa";
  const [programme, controls] = createResource(() => props.slug, () => loadLiveQaProgramme());
  const stage = createMemo(() => programme()?.stages.find(stage => stage.sessions.some(session => session.slug === props.slug)));
  return <>
    <Show when={programme.error}>
      <p class="mt-6 text-sm text-primary-200" role="alert">Q&A availability could not be loaded. <button type="button" class="btn btn-sm btn-outline" onClick={() => void controls.refetch().catch(() => undefined)}>Retry Q&A availability</button></p>
    </Show>
    <Show when={!programme.loading && !programme.error && stage()}>
      {(currentStage) => <>
        <a class="mt-6 inline-flex min-h-11 items-center underline underline-offset-4 text-secondary-300" href={`${directory()}?stage=${encodeURIComponent(currentStage().key)}`}>Main-day Q&A · {currentStage().name} · Choose another talk</a>
        <EligibleLiveQaPanel slug={props.slug} />
      </>}
    </Show>
  </>;
}

/** The key owns every private signal, including drafts and in-flight commands. */
function EligibleLiveQaPanel(props: LiveQaPanelProps) {
  const auth = useAuth();
  const scope = createMemo(() => !auth.isLoading() && auth.isAuthenticated() && auth.user
    ? JSON.stringify([auth.user.id, auth.user.role, props.slug]) : undefined);
  return (
    <section id="live-qa" aria-labelledby="live-qa-heading" class="glass-panel rounded-2xl min-w-0 p-4 sm:p-6 md:p-8 mt-8 scroll-mt-24 space-y-5">
      <header class="space-y-2">
        <h2 id="live-qa-heading" class="text-2xl font-bold text-white">Live Q&A</h2>
        <p class="text-sm text-primary-200">Private: only you, MCs and administrators can read your questions.</p>
      </header>
      <Show when={!auth.isLoading()} fallback={<p role="status">Checking your login…</p>}>
        <Show when={scope()} keyed fallback={
          <div class="space-y-3">
            <p>Log in to ask and read your questions.</p>
            <a href={`/login?redirect_url=${encodeURIComponent(`/sessions/${props.slug}#live-qa`)}`} onClick={() => loginRedirect()} class="btn btn-primary min-h-12 whitespace-nowrap">Log in to ask</a>
          </div>
        }>
          {(key) => <PrivateLiveQa slug={props.slug} actorId={auth.user!.id} current={() => scope() === key} />}
        </Show>
      </Show>
    </section>
  );
}

interface PrivateLiveQaProps extends LiveQaPanelProps { actorId: string; current: () => boolean }
function PrivateLiveQa(props: PrivateLiveQaProps) {
  const slug = props.slug;
  const actorId = props.actorId;
  const [session, setSession] = createSignal<LiveQaSession>();
  const [page, setPage] = createSignal(1);
  const [reading, setReading] = createSignal(false);
  const [readAction, setReadAction] = createSignal(false);
  const [readError, setReadError] = createSignal("");
  const [denied, setDenied] = createSignal(false);
  const [body, setBody] = createSignal("");
  const [held, setHeld] = createSignal<AskCommand>();
  const [sending, setSending] = createSignal(false);
  const [askError, setAskError] = createSignal("");
  const [sent, setSent] = createSignal(false);
  const [moderating, setModerating] = createSignal(false);
  const [moderationError, setModerationError] = createSignal("");
  let alive = true;
  let epoch = 0;
  let readInFlight = false;
  let askInFlight = false;
  let moderationInFlight = false;
  // Plain variables guard same-tick calls under Solid 2's transactional writes.
  let command: AskCommand | undefined;
  let ambiguous = false;
  let requestedPage = 1;
  let queuedPage: number | undefined;
  const current = () => alive && props.current();
  const draftLength = createMemo(() => Array.from(body().trim()).length);
  const validDraft = () => draftLength() > 0 && draftLength() <= 1000;
  const canAsk = () => !denied() && !!session()?.accepting && !readError();
  const canModerate = () => !denied() && !!session()?.canModerate && !readError();

  function revokePrivateData() {
    epoch++;
    setSession(undefined);
    setDenied(true);
    setSent(false);
    // Hide private DOM immediately, but retain an unresolved exact command in memory.
    if (!command) setBody("");
  }

  async function refresh(nextPage = requestedPage, background = false) {
    if (!current() || askInFlight || moderationInFlight) return;
    if (readInFlight) {
      // Keep controls stable during polls without dropping a user's page/refresh
      // click. Serialize it after the poll so denial handling still runs first.
      if (!background) { queuedPage = nextPage; setReadAction(true); }
      return;
    }
    readInFlight = true;
    requestedPage = nextPage;
    const version = ++epoch;
    setReading(true);
    setReadAction(!background);
    try {
      const result = await liveQaRequest<LiveQaSession>({ operation: "session", slug, page: nextPage }, actorId);
      if (!current() || version !== epoch) return;
      if (!validSession(result, slug, nextPage)) throw new Error("Invalid Q&A response");
      setSession(result);
      setPage(nextPage);
      setDenied(false);
      setReadError("");
    } catch (error) {
      if (!current() || version !== epoch) return;
      setSession(undefined);
      if (error instanceof LiveQaClientError && (error.status === 401 || error.status === 403)) {
        revokePrivateData();
        setReadError("Q&A access could not be verified. Log in again or refresh to check access.");
      } else {
        setReadError("Couldn't refresh questions. New questions are paused until a refresh succeeds.");
      }
    } finally {
      readInFlight = false;
      if (current()) {
        setReading(false);
        setReadAction(false);
        if (queuedPage !== undefined) {
          const next = queuedPage;
          queuedPage = undefined;
          void refresh(next);
        }
      }
    }
  }

  async function sendQuestion() {
    if (!current() || askInFlight || moderationInFlight || denied()) return;
    if (!command && (!canAsk() || !validDraft())) return;
    const attempt = command ?? { operation: "ask" as const, slug, body: body().trim(), requestId: crypto.randomUUID() };
    command = attempt;
    setHeld(attempt);
    const wasAmbiguous = ambiguous;
    askInFlight = true;
    const version = ++epoch;
    setSending(true);
    setSent(false);
    setAskError("");
    try {
      const result = await liveQaRequest<{ question: LiveQaQuestion }>(attempt, actorId);
      if (!current() || version !== epoch) return;
      if (!result || !validQuestion(result.question) || !result.question.own || result.question.body !== attempt.body) {
        throw new Error("Unmatched question acknowledgement");
      }
      command = undefined;
      ambiguous = false;
      setHeld(undefined);
      setBody("");
      setSent(true);
    } catch (error) {
      if (!current() || version !== epoch) return;
      const status = error instanceof LiveQaClientError ? error.status : undefined;
      const definite = !wasAmbiguous && (status === 400 || status === 409 || status === 429);
      if (definite) {
        command = undefined;
        setHeld(undefined);
        ambiguous = false;
        setAskError(status === 429 ? "Please wait before sending another question. Your draft is still editable."
          : status === 409 ? "Questions are closed. Your draft is still editable."
          : "Your question wasn't accepted. Check your draft and try again.");
      } else {
        ambiguous = true;
        setAskError("We couldn't confirm whether your question was sent. Keep this page open and retry the exact question; it will not be submitted twice.");
      }
      if (status === 401 || status === 403) revokePrivateData();
    } finally {
      askInFlight = false;
      if (current()) {
        setSending(false);
        void refresh();
      }
    }
  }

  async function moderate(request: Extract<LiveQaRequest, { operation: "mode" | "answer" }>) {
    if (!current() || !canModerate() || moderationInFlight || askInFlight) return;
    moderationInFlight = true;
    const version = ++epoch;
    setModerating(true);
    setModerationError("");
    try {
      const result = await liveQaRequest<{ ok: true }>(request, actorId);
      if (!current() || version !== epoch) return;
      if (result?.ok !== true) throw new Error("Invalid moderation acknowledgement");
    } catch (error) {
      if (!current() || version !== epoch) return;
      setModerationError("Couldn't confirm the change. Refresh to check the current state before trying again.");
      if (error instanceof LiveQaClientError && (error.status === 401 || error.status === 403)) revokePrivateData();
    } finally {
      moderationInFlight = false;
      if (current()) {
        setModerating(false);
        void refresh();
      }
    }
  }

  onCleanup(() => { alive = false; epoch++; });
  onSettled(() => {
    if (typeof window === "undefined") return;
    void refresh();
    const poll = () => { if (!document.hidden) void refresh(requestedPage, true); };
    const timer = window.setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  });

  function modeLabel(mode: LiveQaMode | undefined) {
    return mode === "open" ? "MC override: open" : mode === "closed" ? "MC override: closed" : "Using agenda timing";
  }

  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div role="status" class="text-sm">
          <Show when={session()} fallback={<span>{reading() && !readError() ? "Checking questions…" : "Question availability not verified."}</span>}>
            {(data) => <><strong class="block text-white">{data().accepting ? "Questions are open" : "Questions are closed"}</strong><span>{modeLabel(data().mode)}</span></>}
          </Show>
        </div>
        <button type="button" class="btn btn-outline min-h-12 whitespace-nowrap" disabled={readAction() || sending() || moderating()} onClick={() => void refresh()}>Refresh questions</button>
      </div>
      <Show when={session() && !session()!.accepting}><p class="text-sm text-primary-200">You can still read submitted questions or prepare a draft.</p></Show>
      <Show when={readError()}><p role="alert" class="alert alert-warning">{readError()}</p></Show>
      <Show when={denied()}>
        <a href={`/login?redirect_url=${encodeURIComponent(`/sessions/${slug}#live-qa`)}`} onClick={() => loginRedirect()} class="btn btn-outline min-h-12">Log in again</a>
      </Show>
      {/* Polling never owns the form. A read error cannot discard a draft or frozen retry. */}
      <Show when={!denied()}>
        <form class="space-y-3" onSubmit={(event) => { event.preventDefault(); void sendQuestion(); }}>
          <label for="live-qa-question" class="block font-bold text-white">Your question</label>
          <p id="live-qa-draft-help" class="text-sm text-primary-200">About this session. No names or contact details needed.</p>
          <textarea id="live-qa-question" name="question" class="textarea textarea-bordered w-full min-w-0 min-h-28 text-base" rows={3} value={body()} readonly={!!held()} disabled={sending()} aria-describedby="live-qa-draft-help live-qa-draft-count" onInput={(event) => { setBody(event.currentTarget.value); setSent(false); }} />
          <p id="live-qa-draft-count" class={draftLength() > 1000 ? "text-error text-sm" : "text-primary-200 text-sm"} aria-live="polite">{draftLength()} / 1000 characters<Show when={draftLength() > 1000}> — Shorten your question before sending.</Show></p>
          <Show when={held()}><p class="text-sm">This question is locked until delivery is confirmed. Exact retries also work after questions close.</p></Show>
          <Show when={askError()}><p role="alert" class="alert alert-warning">{askError()}</p></Show>
          <Show when={sent()}><p role="status" class="text-success font-bold">Question sent</p></Show>
          <button type="submit" class="btn btn-primary min-h-12 w-full sm:w-auto whitespace-nowrap" disabled={sending() || moderating() || (!held() && (!canAsk() || !validDraft()))}>
            {sending() ? "Sending question…" : held() ? "Retry exact question" : "Send question"}
          </button>
        </form>
      </Show>
      <Show when={canModerate()}>
        <fieldset class="min-w-0 border-t border-white/15 pt-3 space-y-3" disabled={moderating() || sending()}>
          <legend class="px-2 font-bold text-white">MC controls</legend>
          <p class="text-sm text-primary-200">Overrides stay active until changed.</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline min-h-12 whitespace-nowrap" aria-pressed={session()?.mode === "open" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "open" })}>Open questions</button>
            <button type="button" class="btn btn-outline min-h-12 whitespace-nowrap" aria-pressed={session()?.mode === "closed" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "closed" })}>Close questions</button>
            <button type="button" class="btn btn-outline min-h-12 whitespace-nowrap" aria-pressed={session()?.mode === "auto" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "auto" })}>Use agenda timing</button>
          </div>
        </fieldset>
      </Show>
      <Show when={moderationError() && !denied()}><p role="alert" class="alert alert-warning">{moderationError()}</p></Show>
      <details class="text-sm text-primary-200">
        <summary class="cursor-pointer min-h-12 py-3 text-white focus-visible:outline-2 focus-visible:outline-primary-400">How timing works</summary>
        <p>Questions open during the scheduled slot and remain readable afterward. MCs can override timing for delays; “Use agenda timing” clears the override.</p>
      </details>
      <Show when={session()}>
        {(data) => <section aria-label="Submitted questions" class="border-t border-white/15 pt-4 space-y-3 min-w-0">
          <h3 class="text-xl font-bold text-white">{data().canModerate ? "Session questions" : "Your questions"}</h3>
          <p class="text-sm text-primary-200">Oldest first · Updates every 5 seconds while visible</p>
          <Show when={data().questions.length} fallback={<p>{page() > 1 ? "No questions on this page." : data().canModerate ? "No questions yet." : "You haven't sent any questions yet."}</p>}>
            <ul class="divide-y divide-white/15 list-none p-0">
              <For each={data().questions} keyed={question => question.id}>
                {(question) => <li class="py-4 space-y-3 min-w-0">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <Show when={question().own}><span class="font-bold text-white">Your question</span></Show>
                    <span class={question().answered ? "badge badge-success" : "badge badge-outline"}>{question().answered ? "Answered" : "Unanswered"}</span>
                  </div>
                  <p class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{question().body}</p>
                  <Show when={data().canModerate}>
                    <button type="button" class="btn btn-sm btn-outline min-h-12" disabled={moderating() || sending()} onClick={() => void moderate({ operation: "answer", slug, questionId: question().id, answered: !question().answered })}>{question().answered ? "Reopen question" : "Mark answered"}</button>
                  </Show>
                </li>}
              </For>
            </ul>
          </Show>
          <nav aria-label="Question pages" class="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" aria-label="Previous questions" class="btn btn-sm btn-outline min-h-12 whitespace-nowrap" disabled={readAction() || sending() || moderating() || page() <= 1} onClick={() => void refresh(page() - 1)}>Previous</button>
            <span class="whitespace-nowrap">Page {page()} of {Math.max(1, data().totalPages)}</span>
            <button type="button" aria-label="Next questions" class="btn btn-sm btn-outline min-h-12 whitespace-nowrap" disabled={readAction() || sending() || moderating() || page() >= data().totalPages} onClick={() => void refresh(page() + 1)}>Next</button>
          </nav>
        </section>}
      </Show>
    </div>
  );
}

export default LiveQaPanel;
