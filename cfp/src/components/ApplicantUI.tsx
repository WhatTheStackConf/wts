import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { FieldIssue, SpeakerProfile, ApplicantSettings, Presentation } from "~/lib/cfp-model";

export function ErrorNotice(props: { message?: string; issues?: FieldIssue[]; onRetry?: () => void; retryLabel?: string }) {
  return <div class="alert" role="alert">
    <p>{props.message || "This request did not complete."}</p>
    <Show when={props.issues?.length}>
      <ul class="error-list"><For each={props.issues}>{(issue) => <li><strong>{issue.field}:</strong> {issue.message}</li>}</For></ul>
    </Show>
    <Show when={props.onRetry}><button type="button" class="button button-secondary button-small" onClick={props.onRetry}>{props.retryLabel || "Try again"}</button></Show>
  </div>;
}

export function Section(props: { title: string; children: JSX.Element; editHref?: string; editLabel?: string }) {
  return <section class="confirm-section">
    <div class="surface-title"><h2>{props.title}</h2><Show when={props.editHref}><a class="inline-link" href={props.editHref!}>{props.editLabel || `Edit ${props.title.toLowerCase()}`}</a></Show></div>
    {props.children}
  </section>;
}

function Value(props: { label: string; value: string | null | undefined; wide?: boolean }) {
  return <div class={props.wide ? "wide" : undefined}><dt>{props.label}</dt><dd>{props.value?.trim() || <span class="muted">Not provided</span>}</dd></div>;
}

export function SpeakerSummary(props: { speaker: SpeakerProfile; email: string; editHref?: string }) {
  return <div class="cfp-stack">
    <dl class="read-only-summary"><Value label="Full name" value={props.speaker.fullName} /><Value label="Email" value={props.email} /><Value label="Affiliation" value={props.speaker.affiliation} /><Value label="Short bio" value={props.speaker.bio} wide /><Value label="Social links" value={props.speaker.socialHandles.join("\n")} wide /><Value label="Previous talks" value={props.speaker.previousTalks} wide /></dl>
    <Show when={props.editHref}><a class="inline-link" href={props.editHref!}>Edit speaker profile</a></Show>
  </div>;
}

export function SettingsSummary(props: { settings: ApplicantSettings; editHref?: string }) {
  return <div class="cfp-stack">
    <dl class="read-only-summary"><Value label="Preferred contact method" value={props.settings.preferredContactMethod} /><Value label="Company covers travel or accommodation" value={props.settings.companyCoverExpenses} /></dl>
    <Show when={props.editHref}><a class="inline-link" href={props.editHref!}>Edit applicant settings</a></Show>
  </div>;
}

export function PresentationSummary(props: { presentation: Presentation; editHref?: string }) {
  return <div class="cfp-stack">
    <dl class="read-only-summary">
      <Value label="Title" value={props.presentation.title} wide />
      <div class="wide"><dt>Abstract</dt><dd><div class="rich-html" innerHTML={props.presentation.abstract || "<p>Not provided</p>"} /></dd></div>
      <div class="wide"><dt>Key takeaways</dt><dd><div class="rich-html" innerHTML={props.presentation.keyTakeaways || "<p>Not provided</p>"} /></dd></div>
      <Value label="Technical requirements" value={props.presentation.technicalRequirements} wide />
      <Value label="Previous presentation of this topic" value={props.presentation.previousPresentation} wide />
      <Value label="Notes for organizers" value={props.presentation.organizerNotes} wide />
      <Value label="Additional information" value={props.presentation.additionalInfo} wide />
    </dl>
    <Show when={props.editHref}><a class="inline-link" href={props.editHref!}>Edit presentation</a></Show>
  </div>;
}
