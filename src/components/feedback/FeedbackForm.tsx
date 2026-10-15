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

export function FeedbackForm(props: { token: string; survey: FeedbackSurvey; onComplete: (result: FeedbackResult) => void }) {
  const submission = createFeedbackSubmission(props.token, props.survey.version);
  const [errors, setErrors] = createSignal<FeedbackErrors>({});
  const [sending, setSending] = createSignal(false);
  const [locked, setLocked] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [more, setMore] = createSignal<string[]>([]);
  const [reviews, setReviews] = createSignal<string[]>([]);
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
      <details class="feedback-section feedback-sessions">
        <summary>Feedback on a particular session <span class="feedback-optional">(optional)</span></summary>
        <div class="feedback-session-content">
          <p class="feedback-hint">Pick a session you went to and leave a rating, a comment, or both.</p>
          <Show when={props.survey.sessions.length} fallback={<p>There aren't any sessions listed here.</p>}>
            <label for="feedback-session-picker">Choose a session to review</label>
            <select id="feedback-session-picker" ref={sessionPicker} onChange={event => {
              const id = event.currentTarget.value;
              if (id && props.survey.sessions.some(session => session.id === id)) setReviews(previous => previous.includes(id) ? previous : [...previous, id]);
              event.currentTarget.value = "";
            }}>
              <option value="">Select a session…</option>
              <For each={props.survey.sessions} keyed={session => session.id}>{session => <option value={session().id} disabled={reviews().includes(session().id)}>{session().title}</option>}</For>
            </select>
          </Show>
          <Show when={errors().sessions}><p class="feedback-error">{errors().sessions}</p></Show>
          <For each={reviews()} keyed={id => id}>{id => <fieldset class="feedback-session-review">
            <legend>{props.survey.sessions.find(session => session.id === id())?.title}</legend>
            <input type="hidden" name="sessionId" value={id()} />
            <RatingField name={`session:${id()}:usefulness`} label="How useful was this session to you?" usefulness error={errors()[`session:${id()}:usefulness`]} />
            <TextAnswer name={`session:${id()}:comment`} label="Anything you'd like to share about this session?" error={errors()[`session:${id()}:comment`]} />
            <button type="button" class="feedback-secondary" onClick={() => { setReviews(previous => previous.filter(value => value !== id())); queueMicrotask(() => sessionPicker?.focus()); }}>Remove session review</button>
          </fieldset>}</For>
        </div>
      </details>
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
