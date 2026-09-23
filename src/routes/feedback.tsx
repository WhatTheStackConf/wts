import { Meta, Title } from "@solidjs/meta";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import { FeedbackForm } from "~/components/feedback/FeedbackForm";
import { consumeFeedbackToken, feedbackRequest } from "~/lib/feedback-client";
import type { FeedbackResult, FeedbackState, FeedbackSurvey } from "~/lib/feedback-contract";
import "~/components/feedback/feedback.css";

const terminalCopy: Record<Exclude<FeedbackState, "unavailable" | "invalid_answers">, { heading: string; body: string }> = {
  submitted: { heading: "Thank you for your feedback", body: "We've got your feedback. Thanks for helping us plan next year! You can close this page." },
  used: { heading: "This invitation has already been used", body: "We've already received a response through this link. You can't submit again or edit it." },
  expired: { heading: "This invitation has expired", body: "This link has expired, so we can't accept any more feedback through it." },
  closed: { heading: "Feedback is now closed", body: "We've finished collecting feedback. Thanks for joining us at WhatTheStack 2026." },
  invalid: { heading: "Open your feedback invitation", body: "Open the link in your feedback email to get started. If you got here from that email, try opening the link again." },
};

function FeedbackOutcome(props: { state: keyof typeof terminalCopy }) {
  let heading!: HTMLHeadingElement;
  onSettled(() => {
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: "instant" });
  });
  return <section class="feedback-outcome" aria-labelledby="feedback-outcome-heading">
    <h2 id="feedback-outcome-heading" ref={heading} tabindex="-1">{terminalCopy[props.state].heading}</h2>
    <p>{terminalCopy[props.state].body}</p>
  </section>;
}

export default function FeedbackPage() {
  let token = typeof window === "undefined" ? undefined : consumeFeedbackToken(window.location, window.history);
  const [state, setState] = createSignal<FeedbackState | "loading" | "ready">("loading");
  const [survey, setSurvey] = createSignal<FeedbackSurvey>();
  let alive = true;
  let inspecting = false;
  let generation = 0;
  onCleanup(() => { alive = false; token = undefined; });

  async function inspect() {
    if (inspecting || !alive) return;
    if (!token) { setState("invalid"); return; }
    inspecting = true;
    const currentGeneration = generation;
    setState("loading");
    const result = await feedbackRequest({ action: "inspect", token });
    if (!alive || currentGeneration !== generation) return;
    inspecting = false;
    if (result.state === "ready") {
      setSurvey(result.survey);
      setState("ready");
    } else {
      setState(result.state === "invalid_answers" || result.state === "submitted" ? "unavailable" : result.state);
      if (result.state !== "unavailable" && result.state !== "invalid_answers" && result.state !== "submitted") token = undefined;
    }
  }

  function complete(result: FeedbackResult) {
    if (result.state === "ready" || result.state === "unavailable" || result.state === "invalid_answers") return;
    token = undefined;
    setSurvey(undefined);
    setState(result.state);
  }

  onSettled(() => {
    if (typeof window === "undefined") return;
    // Email clients can reuse an existing tab through a same-document fragment
    // navigation. Drop the previous invitation/draft before inspecting the new one.
    const reopen = () => {
      generation++;
      inspecting = false;
      token = consumeFeedbackToken(window.location, window.history);
      setSurvey(undefined);
      void inspect();
    };
    window.addEventListener("hashchange", reopen);
    void inspect();
    return () => window.removeEventListener("hashchange", reopen);
  });

  const terminal = () => {
    const value = state();
    return value === "invalid" || value === "used" || value === "expired" || value === "closed" || value === "submitted" ? value : undefined;
  };

  return <>
    <Title>WhatTheStack 2026 feedback</Title>
    <Meta name="robots" content="noindex, nofollow" />
    <Meta name="referrer" content="no-referrer" />
    <main class="feedback-page font-sans" id="main-content">
      <div class="feedback-column">
        <header class="feedback-header">
          <h1>WhatTheStack 2026 feedback</h1>
          <p>Thanks for joining us! Tell us what worked and what you'd change for next year.</p>
          <p class="feedback-hint">This takes about 3 minutes. Only the overall rating is required; skip anything else you like.</p>
        </header>
        <noscript><p class="feedback-notice">JavaScript is needed to check the private invitation link and submit feedback. Enable JavaScript, then reopen the original link from your email.</p></noscript>
        <Show when={state() === "loading"}><p class="feedback-status" role="status">Checking your invitation…</p></Show>
        <Show when={state() === "unavailable"}>
          <section class="feedback-outcome" aria-labelledby="feedback-unavailable-heading">
            <h2 id="feedback-unavailable-heading">We couldn't check your invitation</h2>
            <p role="alert">Something went wrong. Keep this page open and try again.</p>
            <button type="button" class="feedback-secondary" onClick={() => void inspect()}>Try again</button>
          </section>
        </Show>
        <Show when={terminal()} keyed>{value => <FeedbackOutcome state={value} />}</Show>
        <Show when={state() === "ready" && survey()} keyed>{current => <>
          <FeedbackForm token={token!} survey={current} onComplete={complete} />
        </>}</Show>
      </div>
    </main>
  </>;
}
