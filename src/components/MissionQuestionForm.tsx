import { createSignal, For, Show } from "solid-js";
import { submitMissionAnswers } from "~/lib/mission-code-redemption-action";
import type { MissionCodeRedemptionResult } from "~/lib/mission-code-redemption";
import type { MissionQuestionChallenge } from "~/lib/mission-questions";

export function MissionQuestionForm(props: { challenge: MissionQuestionChallenge; userId: string; retrySeconds: number; onResult: (result: MissionCodeRedemptionResult) => void }) {
  const [busy, setBusy] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [error, setError] = createSignal("");
  let command: { challengeId: string; operationId: string; answers: Record<string, string> } | undefined;
  // Freeze authority with the challenge, not the mutable cookie or AuthProvider.
  const userId = props.userId;
  let errorRegion: HTMLParagraphElement | undefined;
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy() || props.retrySeconds > 0) return;
    if (!command) {
      const data = new FormData(event.currentTarget as HTMLFormElement);
      command = { challengeId: props.challenge.challengeId, operationId: crypto.randomUUID(), answers: Object.fromEntries(props.challenge.questions.map(q => {
        const value = data.get(q.id);
        return [q.id, typeof value === "string" ? value : ""];
      })) };
    }
    setHeld(true);
    setBusy(true);
    setError("");
    try {
      const result = await submitMissionAnswers(command, userId);
      props.onResult(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Response lost. Retry the exact saved answers; do not start another scan.");
      queueMicrotask(() => errorRegion?.focus());
    } finally { setBusy(false); }
  };
  return <form class="space-y-6" onSubmit={submit} aria-busy={busy() ? "true" : "false"}>
    <fieldset disabled={busy() || held()} class="space-y-8">
      <legend class="sr-only">Mission questions</legend>
      <For each={props.challenge.questions}>{q => <div>
        <Show when={q.kind === "single_choice"} fallback={<>
          <label for={`question-${q.id}`} class="mb-5 block text-xl font-semibold leading-snug text-white">{q.prompt}</label>
          <textarea id={`question-${q.id}`} name={q.id} required maxlength={1000} class="textarea textarea-bordered min-h-28 w-full" autocomplete="off" />
        </>}>
          <fieldset>
            <legend class="mb-5 text-xl font-semibold leading-snug text-white">{q.prompt}</legend>
            <div class="space-y-3">
              <For each={q.kind === "single_choice" ? q.choices : []}>{(c, index) => <label class="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-white/25 p-4 text-base text-white has-checked:border-primary-400 has-checked:bg-primary-500/15 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-400">
                <input id={index() === 0 ? `question-${q.id}` : `question-${q.id}-${c.id}`} type="radio" name={q.id} value={c.id} required class="radio radio-primary shrink-0" />
                <span>{c.label}</span>
              </label>}</For>
            </div>
          </fieldset>
        </Show>
      </div>}</For>
    </fieldset>
    <Show when={error()}><p ref={element => { errorRegion = element; }} role="alert" tabindex="-1" class="text-error">{error()}</p></Show>
    <button type="submit" class="btn btn-primary w-full min-h-12" disabled={busy() || props.retrySeconds > 0}>{busy() ? "Checking answers…" : props.retrySeconds > 0 ? `Retry in ${props.retrySeconds}s` : held() ? "Retry saved answers" : "Submit answers"}</button>
    <details class="text-sm leading-relaxed text-secondary-100">
      <summary class="link link-primary min-h-11 cursor-pointer py-3">How it works</summary>
      <div class="space-y-3 pt-2">
        <Show when={props.challenge.policy === "correct_or_half"} fallback={<p>Answer every question. The configured Mission rules determine whether participation or correct answers earn points.</p>}>
          <p>Correct answers earn full XP; a wrong answer earns half. Each Mission rewards you once, subject to its scoring limits.</p>
        </Show>
        <p>Answer before {new Date(props.challenge.expiresAt).toLocaleTimeString()}. Your first completion is final. If a response is lost, retry the saved answers without scanning again.</p>
      </div>
    </details>
  </form>;
}