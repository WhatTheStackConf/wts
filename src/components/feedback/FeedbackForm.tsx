import { createSignal, For, onCleanup, Show } from "solid-js";
import { createFeedbackSubmission } from "~/lib/feedback-client";
import { FEEDBACK_MORE_OPTIONS, FEEDBACK_PARTS, type FeedbackResult, type FeedbackSurvey } from "~/lib/feedback-contract";
import { readFeedbackAnswers, type FeedbackErrors } from "./form-data";

const experienceScale = ["Very poor", "Poor", "Okay", "Good", "Excellent"];
const usefulnessScale = ["Not useful", "Slightly useful", "Somewhat useful", "Very useful", "Extremely useful"];

function RatingField(props: { name: string; label: string; required?: boolean; na?: boolean; usefulness?: boolean; error?: string }) {
  const [requiredError, setRequiredError] = createSignal(false);
  const error = () => props.error || (requiredError() ? "Choose an overall rating before submitting." : "");
  return <fieldset class="feedback-rating" aria-describedby={error() ? `${props.name}-error` : undefined} onChange={() => setRequiredError(false)}>
    <legend>{props.label} <span class="feedback-optional">({props.required ? "required" : "optional"})</span></legend>
    <div class="feedback-rating-options">
      <For each={props.usefulness ? usefulnessScale : experienceScale}>
        {(label, index) => <label class="feedback-choice">
          <input type="radio" name={props.name} value={String(index() + 1)} required={props.required} aria-invalid={error() ? "true" : undefined} aria-describedby={error() ? `${props.name}-error` : undefined} onInvalid={() => setRequiredError(!!props.required)} />
          <span>{index() + 1} <span class="feedback-choice-label">{label}</span></span>
        </label>}
      </For>
      <Show when={props.na}><label class="feedback-choice"><input type="radio" name={props.name} value="na" aria-invalid={props.error ? "true" : undefined} /><span>N/A <span class="feedback-choice-label">Not applicable</span></span></label></Show>
    </div>
    <Show when={error()}><p class="feedback-error" id={`${props.name}-error`}>{error()}</p></Show>
  </fieldset>;
}

function TextAnswer(props: { name: string; label: string; max?: number; error?: string }) {
  const [length, setLength] = createSignal(0);
  return <div class="feedback-text-answer">
    <label for={props.name}>{props.label} <span class="feedback-optional">(optional)</span></label>
    <textarea id={props.name} name={props.name} rows={3} maxlength={props.max ?? 2000} aria-invalid={props.error ? "true" : undefined} aria-describedby={`${props.name}-hint${props.error ? ` ${props.name}-error` : ""}`} onInput={event => setLength(event.currentTarget.value.length)} />
    <p class="feedback-hint" id={`${props.name}-hint`}>{length()} / {(props.max ?? 2000).toLocaleString("en-GB")} characters</p>
    <Show when={props.error}><p class="feedback-error" id={`${props.name}-error`}>{props.error}</p></Show>
  </div>;
}

function SessionReview(props: { id: string; title: string; errors: FeedbackErrors; onRemove: () => void }) {
  const [editing, setEditing] = createSignal(true);
  const [rating, setRating] = createSignal("");
  const [comment, setComment] = createSignal("");
  let editor!: HTMLDivElement;
  let toggle!: HTMLButtonElement;
  const editorId = () => `session:${props.id}:editor`;
  function toggleEditing() {
    const opening = !editing();
    setEditing(opening);
    queueMicrotask(() => opening ? (editor.querySelector<HTMLInputElement>("input:checked") ?? editor.querySelector<HTMLInputElement>("input"))?.focus() : toggle.focus());
  }
  return <li class="feedback-session-review" aria-labelledby={`session:${props.id}:title`} onInput={event => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) setComment(target.value);
    if (target instanceof HTMLInputElement && target.type === "radio") setRating(target.value);
  }}>
    <h3 id={`session:${props.id}:title`}>{props.title}</h3>
    <div class="feedback-session-summary">
      <p>{rating() ? `Usefulness: ${rating()} / 5 — ${usefulnessScale[Number(rating()) - 1]}` : "No rating yet"}</p>
      <p class="feedback-session-comment">{comment().trim() || "No comment yet"}</p>
    </div>
    <div class="feedback-session-actions">
      <button ref={toggle} type="button" class="feedback-secondary" aria-expanded={editing() ? "true" : "false"} aria-controls={editorId()} aria-label={`${editing() ? "Done editing" : "Edit"}: ${props.title}`} onClick={toggleEditing}>{editing() ? "Done editing" : "Edit"}</button>
      <button type="button" class="feedback-secondary" aria-label={`Remove: ${props.title}`} onClick={props.onRemove}>Remove</button>
    </div>
    <input type="hidden" name="sessionId" value={props.id} />
    {/* Keep native inputs mounted when collapsed: FormData owns the draft. */}
    <div ref={editor} id={editorId()} class="feedback-session-editor" data-session-editor hidden={!editing()}>
      <RatingField name={`session:${props.id}:usefulness`} label="How useful was this session to you?" usefulness error={props.errors[`session:${props.id}:usefulness`]} />
      <TextAnswer name={`session:${props.id}:comment`} label="Anything you'd like to share about this session?" error={props.errors[`session:${props.id}:comment`]} />
    </div>
  </li>;
}

export function FeedbackForm(props: { token: string; survey: FeedbackSurvey; onComplete: (result: FeedbackResult) => void }) {
  const submission = createFeedbackSubmission(props.token, props.survey.version);
  const [errors, setErrors] = createSignal<FeedbackErrors>({});
  const [sending, setSending] = createSignal(false);
  const [locked, setLocked] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [more, setMore] = createSignal<string[]>([]);
  const [reviews, setReviews] = createSignal<string[]>([]);
  const [selectedSession, setSelectedSession] = createSignal("");
  let form!: HTMLFormElement;
  let sessionPicker!: HTMLSelectElement;
  let alive = true;
  let inFlight = false;
  onCleanup(() => { alive = false; });

  function clearErrors() {
    if (Object.keys(errors()).length) {
      const parsed = readFeedbackAnswers(new FormData(form), props.survey.sessions);
      setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !parsed.ok && !!parsed.errors[key])));
    }
  }

  async function send() {
    if (inFlight) return;
    const parsed = locked() ? undefined : readFeedbackAnswers(new FormData(form), props.survey.sessions);
    if (parsed && !parsed.ok) {
      setErrors(parsed.errors);
      queueMicrotask(() => {
        const firstName = Object.keys(parsed.errors)[0];
        const control = form.elements.namedItem(firstName);
        const target = control instanceof RadioNodeList ? control.item(0) : control;
        if (target instanceof HTMLElement) {
          const details = target.closest("details");
          if (details) details.open = true;
          const editor = target.closest<HTMLElement>("[data-session-editor]");
          if (editor?.hidden) editor.parentElement?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
          target.focus();
        }
      });
      return;
    }
    inFlight = true;
    setSending(true);
    setMessage("");
    setErrors({});
    const result = await submission.submit(parsed?.ok ? parsed.answers : undefined);
    if (!alive) return;
    inFlight = false;
    setSending(false);
    setLocked(submission.locked());
    if (result.state === "unavailable") {
      setMessage("We couldn't confirm that your feedback arrived. Keep this page open and try again. We've kept your answers unchanged so you can retry without sending a second response.");
    } else if (result.state === "invalid_answers") {
      setMessage("Your feedback didn't go through. Check your answers or shorten your comments, then try again. Your draft is still here. If this keeps happening, copy any comments you want to keep before reopening your email link.");
    } else props.onComplete(result);
  }

  return <form ref={form} class="feedback-form" autocomplete="off" onSubmit={event => { event.preventDefault(); void send(); }} onInput={clearErrors} onChange={clearErrors}>
    <fieldset class="feedback-fields" disabled={sending() || locked()}>
      <legend class="sr-only">Conference feedback</legend>
      <div class="feedback-section feedback-overall">
        <RatingField name="overall" label="Overall, how was WhatTheStack 2026?" required error={errors().overall} />
      </div>
      <section class="feedback-section" aria-labelledby="feedback-parts-heading">
        <h2 id="feedback-parts-heading">A little more detail</h2>
        <p class="feedback-hint">Rate the parts you took part in. Skip the rest or choose N/A.</p>
        <div class="feedback-part-list">
          <For each={FEEDBACK_PARTS}>{part => <RatingField name={`part:${part.id}`} label={part.label} na error={errors()[`part:${part.id}`]} />}</For>
        </div>
      </section>
      <section class="feedback-section feedback-written" aria-labelledby="feedback-next-heading">
        <h2 id="feedback-next-heading">Next year</h2>
        <TextAnswer name="keep" label="What should we keep next year?" error={errors().keep} />
        <TextAnswer name="change" label="What's the most important thing we should change?" error={errors().change} />
        <fieldset aria-describedby={`feedback-more-hint${errors().more ? " feedback-more-error" : ""}`}>
          <legend>What would you like more of next time? <span class="feedback-optional">(optional)</span></legend>
          <p class="feedback-hint" id="feedback-more-hint">Choose up to three. {more().length} of 3 selected.</p>
          <div class="feedback-more-options">
            <For each={FEEDBACK_MORE_OPTIONS}>{option => <label class="feedback-choice">
              <input type="checkbox" name="more" value={option.id} checked={more().includes(option.id)} disabled={more().length >= 3 && !more().includes(option.id)} aria-invalid={errors().more ? "true" : undefined} onChange={event => {
                const selected = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="more"]:checked')).map(input => input.value);
                if (selected.length > 3) { event.currentTarget.checked = false; return; }
                setMore(selected);
              }} />
              <span>{option.label}</span>
            </label>}</For>
          </div>
          <Show when={errors().more}><p id="feedback-more-error" class="feedback-error">{errors().more}</p></Show>
          <Show when={more().includes("other")}><TextAnswer name="moreOther" label="What else would you like more of?" max={500} error={errors().moreOther} /></Show>
        </fieldset>
      </section>
      <section class="feedback-section feedback-sessions" aria-labelledby="feedback-sessions-heading">
        <h2 id="feedback-sessions-heading">Session feedback <span class="feedback-optional">(optional)</span></h2>
        <p class="feedback-hint" id="feedback-sessions-hint">You can review more than one session. Edit or remove any review before submitting.</p>
        <div class="feedback-session-content">
          <p class="feedback-hint">Leave a rating, a comment, or both. Session reviews are only sent when you choose Submit feedback below.</p>
          <Show when={reviews().length}>
            <ul class="feedback-session-list" aria-label="Your session reviews">
              <For each={reviews()} keyed={id => id}>{id => <SessionReview id={id()} title={props.survey.sessions.find(session => session.id === id())?.title ?? "Session"} errors={errors()} onRemove={() => {
                setReviews(previous => previous.filter(value => value !== id()));
                clearErrors();
                queueMicrotask(() => sessionPicker?.focus());
              }} />}</For>
            </ul>
          </Show>
          <Show when={props.survey.sessions.length} fallback={<p>There aren't any sessions listed here.</p>}>
            <label for="feedback-session-picker">Choose a session to review</label>
            <select id="feedback-session-picker" ref={sessionPicker} value={selectedSession()} aria-describedby="feedback-sessions-hint" disabled={reviews().length === props.survey.sessions.length} onChange={event => setSelectedSession(event.currentTarget.value)}>
              <option value="">Select a session…</option>
              <For each={props.survey.sessions} keyed={session => session.id}>{session => <option value={session().id} disabled={reviews().includes(session().id)}>{session().title}</option>}</For>
            </select>
            <button type="button" class="feedback-secondary" disabled={!selectedSession() || reviews().includes(selectedSession())} onClick={() => {
              const id = selectedSession();
              if (sending() || locked() || !id || reviews().includes(id) || !props.survey.sessions.some(session => session.id === id)) return;
              setReviews(previous => [...previous, id]);
              setSelectedSession("");
              sessionPicker.value = "";
              queueMicrotask(() => {
                const input = form.elements.namedItem(`session:${id}:usefulness`);
                if (input instanceof RadioNodeList) (input.item(0) as HTMLInputElement)?.focus();
              });
            }}>{reviews().length ? "Add another session" : "Add session"}</button>
            <Show when={reviews().length === props.survey.sessions.length}><p class="feedback-hint">All listed sessions have been added. You can still edit or remove any review above.</p></Show>
          </Show>
          <Show when={errors().sessions}><p class="feedback-error">{errors().sessions}</p></Show>
        </div>
      </section>
    </fieldset>
    <div class="feedback-submit">
      <Show when={message()}><p role="alert" class="feedback-notice">{message()}</p></Show>
      <Show when={Object.keys(errors()).length}><p role="alert" class="feedback-error">Please check the highlighted answer before submitting.</p></Show>
      <p class="feedback-hint">Check your answers before submitting. You can't change them afterwards.</p>
      <button type="submit" class="feedback-primary" disabled={sending()}>{sending() ? "Submitting…" : locked() ? "Retry submission" : "Submit feedback"}</button>
      <p class="feedback-hint">Keep this tab open until you're done. Refreshing or closing it clears your draft.</p>
    </div>
  </form>;
}
