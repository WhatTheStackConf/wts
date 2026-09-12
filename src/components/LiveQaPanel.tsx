import { createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { LiveQaClientError, liveQaRequest } from "~/lib/live-qa-client";
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

/** The key owns every private signal, including drafts and in-flight commands. */
export function LiveQaPanel(props: LiveQaPanelProps) {
  const auth = useAuth();
  const scope = createMemo(() => !auth.isLoading() && auth.isAuthenticated() && auth.user
    ? JSON.stringify([auth.user.id, auth.user.role, props.slug]) : undefined);
  return (
    <section id="live-qa" aria-labelledby="live-qa-heading" class="glass-panel rounded-2xl p-6 md:p-8 mt-8 scroll-mt-24 space-y-5">
      <header class="space-y-2">
        <p class="speaker-kicker">Live Q&A</p>
        <h2 id="live-qa-heading" class="text-2xl font-bold text-white">Questions for this session</h2>
        <p class="text-sm text-primary-200">Questions are private: only you and the MC or administrators can read yours. Other attendees cannot see them.</p>
      </header>
      <Show when={!auth.isLoading()} fallback={<p role="status">Checking your login…</p>}>
        <Show when={scope()} keyed fallback={
          <div class="space-y-3">
            <p>Log in to send a question and read your previous questions.</p>
            <a href={`/login?redirect_url=${encodeURIComponent(`/sessions/${props.slug}#live-qa`)}`} onClick={() => loginRedirect()} class="btn btn-primary min-h-12">Log in to ask a question</a>
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

  async function refresh(nextPage = requestedPage) {
    if (!current() || readInFlight || askInFlight || moderationInFlight) return;
    readInFlight = true;
    requestedPage = nextPage;
    const version = ++epoch;
    setReading(true);
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
      if (current()) setReading(false);
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
    const poll = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  });

  function modeLabel(mode: LiveQaMode | undefined) {
    return mode === "open" ? "MC override: open" : mode === "closed" ? "MC override: closed" : "Using agenda timing";
  }

  return (
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div role="status" class="text-sm">
          <Show when={session()} fallback={<span>Question availability not verified.</span>}>
            {(data) => <><strong class="block text-white">{data().accepting ? "Questions are open" : "Questions are closed"}</strong><span>{modeLabel(data().mode)}</span></>}
          </Show>
        </div>
        <button type="button" class="btn btn-outline min-h-12" disabled={reading() || sending() || moderating()} onClick={() => void refresh()}>Refresh questions</button>
      </div>
      <p class="text-sm text-primary-200">Agenda timing opens questions during this session's scheduled slot. The MC can adjust for delays. Your questions remain readable after the session ends.</p>
      <Show when={readError()}><p role="alert" class="alert alert-warning">{readError()}</p></Show>
      <Show when={denied()}>
        <a href={`/login?redirect_url=${encodeURIComponent(`/sessions/${slug}#live-qa`)}`} onClick={() => loginRedirect()} class="btn btn-outline min-h-12">Log in again</a>
      </Show>
      {/* Polling never owns the form. A read error cannot discard a draft or frozen retry. */}
      <Show when={!denied()}>
        <form class="space-y-3" onSubmit={(event) => { event.preventDefault(); void sendQuestion(); }}>
          <label for="live-qa-question" class="block font-bold text-white">Your question</label>
          <textarea id="live-qa-question" name="question" class="textarea textarea-bordered w-full min-h-36 text-base" rows={4} value={body()} readonly={!!held()} disabled={sending()} aria-describedby="live-qa-draft-help" onInput={(event) => { setBody(event.currentTarget.value); setSent(false); }} />
          <p id="live-qa-draft-help" class="text-sm text-primary-200">Keep it focused on this session. No names or contact details are needed. Limit: 1000 characters.</p>
          <p class={draftLength() > 1000 ? "text-error text-sm" : "text-primary-200 text-sm"} aria-live="polite">{draftLength()} / 1000 characters<Show when={draftLength() > 1000}> — Shorten your question before sending.</Show></p>
          <Show when={held()}><p class="text-sm">This question is locked until delivery is confirmed. Exact retries also work after questions close.</p></Show>
          <Show when={askError()}><p role="alert" class="alert alert-warning">{askError()}</p></Show>
          <Show when={sent()}><p role="status" class="text-success font-bold">Question sent</p></Show>
          <button type="submit" class="btn btn-primary min-h-12 w-full sm:w-auto" disabled={sending() || moderating() || (!held() && (!canAsk() || !validDraft()))}>
            {sending() ? "Sending question…" : held() ? "Retry exact question" : "Send question"}
          </button>
        </form>
      </Show>
      <Show when={canModerate()}>
        <fieldset class="border border-white/15 rounded-xl p-4 space-y-3" disabled={moderating() || sending()}>
          <legend class="px-2 font-bold text-white">MC controls</legend>
          <p class="text-sm text-primary-200">Open and closed overrides stay in effect until changed. Use agenda timing to clear the override.</p>
          <div class="flex flex-wrap gap-3">
            <button type="button" class="btn btn-outline min-h-12" aria-pressed={session()?.mode === "open" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "open" })}>Open questions</button>
            <button type="button" class="btn btn-outline min-h-12" aria-pressed={session()?.mode === "closed" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "closed" })}>Close questions</button>
            <button type="button" class="btn btn-outline min-h-12" aria-pressed={session()?.mode === "auto" ? "true" : "false"} onClick={() => void moderate({ operation: "mode", slug, mode: "auto" })}>Use agenda timing</button>
          </div>
        </fieldset>
      </Show>
      <Show when={moderationError() && !denied()}><p role="alert" class="alert alert-warning">{moderationError()}</p></Show>
      <Show when={session()}>
        {(data) => <section aria-label="Submitted questions" class="space-y-4">
          <h3 class="text-xl font-bold text-white">{data().canModerate ? "Session questions" : "Your questions"}</h3>
          <p class="text-sm text-primary-200">Oldest first · Up to 50 questions per page · Refreshes every 5 seconds while visible.</p>
          <Show when={data().questions.length} fallback={<p>No questions on this page yet.</p>}>
            <ul class="space-y-3 list-none p-0">
              <For each={data().questions}>
                {(question) => <li class="rounded-xl border border-white/15 p-4 space-y-3">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <Show when={question.own}><span class="font-bold text-white">Your question</span></Show>
                    <span class={question.answered ? "badge badge-success" : "badge badge-outline"}>{question.answered ? "Answered" : "Unanswered"}</span>
                  </div>
                  <p class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{question.body}</p>
                  <Show when={data().canModerate}>
                    <button type="button" class="btn btn-sm btn-outline min-h-12" disabled={moderating() || sending()} onClick={() => void moderate({ operation: "answer", slug, questionId: question.id, answered: !question.answered })}>{question.answered ? "Reopen question" : "Mark answered"}</button>
                  </Show>
                </li>}
              </For>
            </ul>
          </Show>
          <nav aria-label="Question pages" class="flex flex-wrap items-center gap-3">
            <button type="button" class="btn btn-outline min-h-12" disabled={reading() || sending() || moderating() || page() <= 1} onClick={() => void refresh(page() - 1)}>Previous questions</button>
            <span>Page {page()} of {Math.max(1, data().totalPages)}</span>
            <button type="button" class="btn btn-outline min-h-12" disabled={reading() || sending() || moderating() || page() >= data().totalPages} onClick={() => void refresh(page() + 1)}>Next questions</button>
          </nav>
        </section>}
      </Show>
    </div>
  );
}

export default LiveQaPanel;
