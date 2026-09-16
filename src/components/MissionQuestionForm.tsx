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
  return <form class="mt-5 space-y-4" onSubmit={submit} aria-busy={busy() ? "true" : "false"}>
    <p class="text-sm">Answer every question. This challenge expires at {new Date(props.challenge.expiresAt).toLocaleTimeString()}; the server checks the Mission window when you submit.</p>
    <fieldset disabled={busy() || held()} class="space-y-4">
      <legend class="sr-only">Mission questions</legend>
      <For each={props.challenge.questions}>{q => <div>
        <label for={`question-${q.id}`} class="label block whitespace-normal break-words">{q.prompt}</label>
        <Show when={q.kind === "single_choice"} fallback={<textarea id={`question-${q.id}`} name={q.id} required maxlength={1000} class="textarea textarea-bordered w-full" autocomplete="off" />}>
          <select id={`question-${q.id}`} name={q.id} required class="select select-bordered w-full">
            <option value="">Choose an answer</option>
            <For each={q.kind === "single_choice" ? q.choices : []}>{c => <option value={c.id}>{c.label}</option>}</For>
          </select>
        </Show>
      </div>}</For>
    </fieldset>
    <Show when={held()}><p class="text-sm">Answers are held for exact retry until the server confirms the outcome.</p></Show>
    <Show when={error()}><p ref={element => { errorRegion = element; }} role="alert" tabindex="-1" class="text-error">{error()}</p></Show>
    <button type="submit" class="btn btn-primary w-full min-h-12" disabled={busy() || props.retrySeconds > 0}>{busy() ? "Checking answers…" : props.retrySeconds > 0 ? `Retry in ${props.retrySeconds}s` : held() ? "Retry saved answers" : "Submit answers"}</button>
  </form>;
}