import { createMemo, createSignal, For, Show } from "solid-js";
import { useAuth } from "~/lib/auth-context";
import { adminReadMissionQuestionnaire, adminSaveMissionQuestionnaire } from "~/lib/mission-question-actions";
import { parseQuestionnaire, type QuestionnaireDefinition } from "~/lib/mission-questions";
import type { SaveMissionQuestionnaireInput } from "~/lib/mission-question-admin";
import type { AdminGamificationOperationsDto } from "~/lib/gamification-operations";
import { AdminFormField, AdminFormSection, adminFormPanelClass, adminInputClass, adminSelectClass, adminTextareaClass } from "~/components/admin/AdminPageShell";

interface QuestionDraft { id: string; kind: "text" | "single_choice"; prompt: string; choices: string; accepted: string }
interface Props { operations: () => AdminGamificationOperationsDto | null | undefined; onChanged: () => unknown }
const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

export default function AdminMissionQuestions(props: Props) {
  const auth = useAuth();
  const [activityId, setActivityId] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [policy, setPolicy] = createSignal<QuestionnaireDefinition["policy"]>("all_correct");
  const [questions, setQuestions] = createSignal<QuestionDraft[]>([]);
  const ids = createMemo(() => questions().map(question => question.id));
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [held, setHeld] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [failed, setFailed] = createSignal(false);
  let command: SaveMissionQuestionnaireInput | undefined;
  let commandUserId = "";
  let loadEpoch = 0;
  const eligible = () => (props.operations()?.activities || []).filter(activity => activity.kind === "qr" && activity.evidenceMode === "single_code");
  const selected = () => eligible().find(activity => activity.id === activityId());
  const editable = () => selected()?.status === "draft";
  const freshQuestion = (): QuestionDraft => ({ id: `q_${crypto.randomUUID().replaceAll("-", "")}`, kind: "text", prompt: "", choices: "", accepted: "" });
  const updateQuestion = (id: string, update: Partial<QuestionDraft>) => setQuestions(current => current.map(question => question.id === id ? { ...question, ...update } : question));

  const load = async (id: string) => {
    const epoch = ++loadEpoch;
    const userId = auth.user?.id || "";
    setBusy(true); setFailed(false); setMessage(""); setActivityId(id); setQuestions([]);
    try {
      const saved = id ? await adminReadMissionQuestionnaire(id, userId) : null;
      if (epoch !== loadEpoch || auth.user?.id !== userId) return;
      setVersion(saved?.version || ""); setPolicy(saved?.definition.policy || "all_correct");
      setQuestions(saved ? saved.definition.questions.map(question => ({
        id: question.id, kind: question.kind, prompt: question.prompt,
        choices: question.kind === "single_choice" ? question.choices.map(choice => choice.label).join("\n") : "",
        accepted: question.kind === "single_choice" ? question.acceptedAnswers.map(answer => String(question.choices.findIndex(choice => choice.id === answer) + 1)).join("\n") : question.acceptedAnswers.join("\n"),
      })) : id ? [freshQuestion()] : []);
      command = undefined; commandUserId = ""; setHeld(false); setReason("");
      if (id) setMessage(saved ? "Saved questions loaded. Live Activities are read-only." : "No questions attached: this Activity currently awards points directly after a valid scan.");
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Could not load questions.");
    } finally { if (epoch === loadEpoch) setBusy(false); }
  };

  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (busy()) return;
    setMessage(""); setFailed(false);
    try {
      if (!command) {
        const definition = parseQuestionnaire({ policy: policy(), questions: questions().map(question => {
          const acceptedAnswers = policy() === "all_answered" ? [] : lines(question.accepted);
          return question.kind === "text" ? { id: question.id, kind: question.kind, prompt: question.prompt, acceptedAnswers } : {
            id: question.id, kind: question.kind, prompt: question.prompt,
            choices: lines(question.choices).map((label, index) => ({ id: `option_${index + 1}`, label })),
            acceptedAnswers: acceptedAnswers.map(number => `option_${number}`),
          };
        }) });
        if (!editable() || !reason().trim()) throw new Error("Choose a draft QR Activity and provide a configuration reason.");
        command = { activityId: activityId(), expectedVersion: version(), operationId: crypto.randomUUID(), reason: reason().trim(), definition };
        commandUserId = auth.user?.id || "";
      }
      setHeld(true); setBusy(true);
      const result = await adminSaveMissionQuestionnaire(command, commandUserId);
      setVersion(result.version); command = undefined; commandUserId = ""; setHeld(false);
      setMessage("Questions saved. Activate the Activity and scoring, then generate or register its official codes. Scanning will not award points until answers qualify.");
      await props.onChanged();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save questions. Retry the same request.");
    } finally { setBusy(false); }
  };

  return <div class="space-y-6">
    <div class="rounded-xl border border-primary-400/20 bg-primary-500/10 p-5 text-sm leading-relaxed">
      <h2 class="text-xl font-bold text-white">QR points or questions</h2>
      <p class="mt-2">In Catalog, create a QR Activity with a Mission, scoring policy and completion outcome. Leave questions unattached for immediate points, or configure them here while the Activity is a draft.</p>
      <p class="mt-2">After activation, question rules are locked. Create a successor Activity to change a live challenge. Answers are checked on the server; no partial points and no duplicate rewards. Free-text responses are not retained for survey exports.</p>
    </div>
    <AdminFormField id="mission-question-activity" label="QR Activity">
      <select id="mission-question-activity" class={adminSelectClass()} value={activityId()} disabled={busy() || held()} onChange={event => void load(event.currentTarget.value)}>
        <option value="">Choose an Activity</option>
        <For each={eligible()}>{activity => <option value={activity.id}>{activity.key} ({activity.status})</option>}</For>
      </select>
    </AdminFormField>
    <Show when={message()}><div role={failed() ? "alert" : "status"} class={`alert ${failed() ? "alert-error" : "alert-info"}`}>{message()}</div></Show>
    <Show when={held()}><div class="rounded-xl border border-warning/40 p-4 text-sm">The request is held for exact retry. Reload saved configuration to reconcile an uncertain response before editing.</div></Show>
    <Show when={activityId()}>
      <form class={adminFormPanelClass} onSubmit={save} aria-busy={busy() ? "true" : "false"}>
        <fieldset disabled={busy() || held() || !editable()} class="space-y-6">
          <AdminFormSection title="Question workflow" description="Choose whether participation or correct answers qualify for the configured Activity points.">
            <AdminFormField id="mission-question-policy" label="Award rule">
              <select id="mission-question-policy" class={adminSelectClass()} value={policy()} onChange={event => setPolicy(event.currentTarget.value as QuestionnaireDefinition["policy"])}>
                <option value="all_correct">All answers must be correct</option><option value="all_answered">Answer every question (participation)</option>
              </select>
            </AdminFormField>
          </AdminFormSection>
          <For each={ids()}>{id => {
            const question = () => questions().find(item => item.id === id)!;
            return <section class="space-y-4 rounded-xl border border-white/15 p-4" aria-label="Mission question">
              <AdminFormField id={`prompt-${id}`} label="Question" required><textarea id={`prompt-${id}`} class={adminTextareaClass()} required maxlength="500" value={question().prompt} onInput={event => updateQuestion(id, { prompt: event.currentTarget.value })} /></AdminFormField>
              <AdminFormField id={`kind-${id}`} label="Answer type"><select id={`kind-${id}`} class={adminSelectClass()} value={question().kind} onChange={event => updateQuestion(id, { kind: event.currentTarget.value as QuestionDraft["kind"], accepted: "" })}><option value="text">Text answer</option><option value="single_choice">Choose one option</option></select></AdminFormField>
              <Show when={question().kind === "single_choice"}><AdminFormField id={`choices-${id}`} label="Choice labels" hint="One per line, 2–8 choices. Their option numbers start at 1." required><textarea id={`choices-${id}`} class={adminTextareaClass()} required value={question().choices} onInput={event => updateQuestion(id, { choices: event.currentTarget.value })} /></AdminFormField></Show>
              <Show when={policy() === "all_correct"}><AdminFormField id={`accepted-${id}`} label={question().kind === "text" ? "Accepted text answers" : "Correct option numbers"} hint={question().kind === "text" ? "One accepted answer per line, up to 8. Matching ignores outer whitespace and letter case." : "One option number per line. Example: 2 accepts the second choice."} required><textarea id={`accepted-${id}`} class={adminTextareaClass()} required value={question().accepted} onInput={event => updateQuestion(id, { accepted: event.currentTarget.value })} /></AdminFormField></Show>
              <button type="button" class="btn btn-sm btn-outline min-h-12" disabled={questions().length <= 1} onClick={() => setQuestions(current => current.filter(item => item.id !== id))}>Remove question</button>
            </section>;
          }}</For>
          <button type="button" class="btn btn-outline min-h-12" disabled={questions().length >= 10} onClick={() => setQuestions(current => [...current, freshQuestion()])}>Add question</button>
          <AdminFormField id="mission-question-reason" label="Configuration reason" required><input id="mission-question-reason" class={adminInputClass()} required maxlength="500" value={reason()} onInput={event => setReason(event.currentTarget.value)} /></AdminFormField>
        </fieldset>
        <div class="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" class="btn btn-outline min-h-12" disabled={busy()} onClick={() => void load(activityId())}>Reload saved configuration</button>
          <Show when={editable()}><button type="submit" class="btn btn-primary min-h-12" disabled={busy()}>{busy() ? "Saving…" : held() ? "Retry saved request" : "Save questions"}</button></Show>
        </div>
      </form>
    </Show>
  </div>;
}
