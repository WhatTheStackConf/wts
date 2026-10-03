import { createSignal, onSettled, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { getApplication, startDraft } from "~/lib/cfp-actions";
import type { FieldIssue, ApplicationView } from "~/lib/cfp-model";
import { ErrorNotice, PresentationSummary, Section, SettingsSummary, SpeakerSummary } from "~/components/ApplicantUI";

export default function ApplicationDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const [view, setView] = createSignal<ApplicationView>();
  const [error, setError] = createSignal<{ code: string; message: string; issues: FieldIssue[] }>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  let previousIntent = "";
  let pendingRequestId = "";
  const load = async () => {
    setLoading(true);
    try {
      const result = await getApplication(params.id ?? "");
      if (result.ok) { setView(result.value); setError(undefined); }
      else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "The application could not load. Try again later.", issues: [] });
    }
    setLoading(false);
  };
  onSettled(() => { void load().catch(() => { setError({ code: "unavailable", message: "The application could not load. Try again later.", issues: [] }); setLoading(false); }); });

  const begin = async (intent: { kind: "edit"; applicationId: string; expectedRevision: number } | { kind: "reuse"; applicationId: string }) => {
    if (busy() || !view()) return;
    const intentKey = JSON.stringify(intent);
    if (intentKey !== previousIntent || !pendingRequestId) {
      previousIntent = intentKey;
      pendingRequestId = crypto.randomUUID();
    }
    setBusy(true);
    try {
      const result = await startDraft({ requestId: pendingRequestId, intent });
      if (result.ok) {
        pendingRequestId = "";
        navigate(`/apply/${result.value.draft.id}`);
      } else setError({ code: result.error.code, message: result.error.message, issues: result.error.issues });
    } catch {
      setError({ code: "unavailable", message: "The draft request failed. Your submitted application is unchanged. Try again.", issues: [] });
    }
    setBusy(false);
  };

  return <>
    <div class="row row-between"><a class="inline-link" href="/applications">Back to applications</a><Show when={view()}><span class="cfp-status" data-state={view()?.application.status}>{view()?.application.status}</span></Show></div>
    <Show when={loading()}><div class="cfp-loading" role="status">Loading application…</div></Show>
    <Show when={error()}><ErrorNotice message={error()?.message} issues={error()?.issues} onRetry={() => void load()} /><Show when={error()?.code === "unauthenticated"}><a class="button" href={`/auth/login?returnTo=${encodeURIComponent(`/applications/${params.id ?? ""}`)}`} rel="external">Sign in to continue</a></Show><Show when={error()?.code === "finalized"}><a class="inline-link" href={`/applications/${params.id ?? ""}`}>Open this application to create a Reuse draft.</a></Show></Show>
    <Show when={view() && error()?.code !== "unauthenticated" && error()?.code !== "unavailable"}>
      <header class="page-heading"><h1>{view()!.application.presentation.title || "Untitled talk"}</h1><p>Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(view()!.application.submittedAt)} · application revision {view()!.application.revision}</p></header>
      <section class="surface cfp-stack">
        <div class="surface-title"><div><h2>Application actions</h2><p>{view()!.application.status === "pending" ? "Edit creates a private draft. Your submitted application stays unchanged until confirmation." : "This application is finalized. Reuse copies its presentation into a new independent draft."}</p></div></div>
        <div class="row">
          <Show when={view()!.application.status === "pending"}>
            <button type="button" class="button" disabled={!view()!.cfpOpen || busy()} onClick={() => void begin({ kind: "edit", applicationId: view()!.application.id, expectedRevision: view()!.application.revision })}>Edit pending application</button>
          </Show>
          <Show when={view()!.application.status !== "pending"}>
            <button type="button" class="button" disabled={!view()!.cfpOpen || busy()} onClick={() => void begin({ kind: "reuse", applicationId: view()!.application.id })}>Reuse as a new application</button>
          </Show>
          <Show when={!view()!.cfpOpen}><span class="cfp-status" data-state="closed">CFP closed</span></Show>
        </div>
        <Show when={!view()!.cfpOpen}><p class="muted">You can read this application, but you cannot create or save a draft while the CFP is closed.</p></Show>
      </section>
      <article class="surface cfp-stack" aria-label="Submitted application details">
        <Section title="Speaker profile"><SpeakerSummary speaker={view()!.speaker.value} email={view()!.email} /></Section>
        <Section title="Applicant settings"><SettingsSummary settings={view()!.settings.value} /></Section>
        <Section title="Presentation"><PresentationSummary presentation={view()!.application.presentation} /></Section>
      </article>
    </Show>
  </>;
}
