import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { getWorkspace, startDraft } from "~/lib/cfp-actions";
import type { FieldIssue, Workspace } from "~/lib/cfp-model";
import { PageBand } from "~/components/PageBand";
import { ErrorNotice } from "~/components/ApplicantUI";

export default function Applications() {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = createSignal<Workspace>();
  const [error, setError] = createSignal<{ message: string; code: string; issues: FieldIssue[] }>();
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const cfpOpen = () => workspace()?.cfpOpen;

  const load = async () => {
    setLoading(true);
    try {
      const result = await getWorkspace();
      if (result.ok) {
        setWorkspace(result.value);
        setError(undefined);
      } else {
        setError({ message: result.error.message, code: result.error.code, issues: result.error.issues });
      }
    } catch {
      setError({ message: "The applicant workspace is unavailable. Try again later.", code: "unavailable", issues: [] });
    }
    setLoading(false);
  };

  onSettled(() => { void load().catch(() => { setError({ message: "The applicant workspace is unavailable. Try again later.", code: "unavailable", issues: [] }); setLoading(false); }); });

  const begin = async (intent: { kind: "new" } | { kind: "reuse"; applicationId: string } | { kind: "edit"; applicationId: string; expectedRevision: number }) => {
    if (busy()) return;
    setBusy(true);
    try {
      const result = await startDraft({ requestId: crypto.randomUUID(), intent });
      if (result.ok) navigate(`/apply/${result.value.draft.id}`);
      else setError({ message: result.error.message, code: result.error.code, issues: result.error.issues });
    } catch {
      setError({ message: "The draft request failed. Your existing applications are unchanged.", code: "unavailable", issues: [] });
    }
    setBusy(false);
  };

  return <>
    <PageBand title="Your proposals" lede="Continue a draft or check the status of what you submitted." />
    <Switch>
      <Match when={loading()}><div class="cfp-loading" role="status">Loading your applicant dashboard…</div></Match>
      <Match when={error()}>{(current) => <><ErrorNotice message={current().message} issues={current().issues} onRetry={() => void load()} /><Show when={current().code === "unauthenticated"}><a class="button" href="/auth/login?returnTo=%2Fapplications" rel="external">Sign in to continue</a></Show></>}</Match>
      <Match when={workspace()}>
        <section class="surface cfp-stack" aria-labelledby="application-actions-title">
          <div class="surface-title"><div><h2 id="application-actions-title">Start a proposal</h2><p>{cfpOpen() ? "Start a new talk proposal. Your speaker profile fills in for you." : "The CFP is closed. You can still read your proposals and update your profile."}</p></div>
            <span class="cfp-status" data-state={cfpOpen() ? "active" : "closed"}>{cfpOpen() ? "Open" : "Closed"}</span>
          </div>
          <Show when={cfpOpen()}><button type="button" class="button" disabled={busy()} onClick={() => void begin({ kind: "new" })}>{busy() ? "Creating draft…" : "New proposal"}</button></Show>
          <div class="row"><a href="/profile">Edit your profile</a></div>
        </section>
        <section class="surface cfp-stack" aria-labelledby="draft-list-title">
          <div class="surface-title"><div><h2 id="draft-list-title">Active drafts</h2><p>Drafts save each time you go to the next step.</p></div></div>
          <Show when={workspace()!.drafts.length} fallback={<p class="empty-state">You have no active drafts.</p>}>
            <ul class="cfp-list"><For each={workspace()!.drafts}>{(draft) => <li class="list-item"><div><h3>{draft.title || "Untitled talk"}</h3><p class="mono">Updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(draft.updatedAt)}</p></div><a class="button button-secondary button-small" href={`/apply/${draft.id}`}>Continue draft</a></li>}</For></ul>
          </Show>
        </section>
        <section class="surface cfp-stack" aria-labelledby="application-list-title">
          <div class="surface-title"><div><h2 id="application-list-title">Submitted proposals</h2><p>Each proposal has its own status.</p></div></div>
          <Show when={workspace()!.applications.length} fallback={<p class="empty-state">Your submitted proposals show here.</p>}>
            <ul class="cfp-list"><For each={workspace()!.applications}>{(application) => <li class="list-item"><div><h3>{application.title || "Untitled talk"}</h3><p class="mono">Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(application.submittedAt)} · revision {application.revision}</p></div><div class="row"><span class="cfp-status" data-state={application.status}>{application.status}</span><a class="button button-secondary button-small" href={`/applications/${application.id}`}>View application</a></div></li>}</For></ul>
          </Show>
        </section>
        <Show when={!cfpOpen()}><div class="alert" role="status">New drafts, draft changes, pending edits, and submissions are unavailable while the CFP is closed. Reads and profile maintenance remain available.</div></Show>
      </Match>
    </Switch>
  </>;
}
