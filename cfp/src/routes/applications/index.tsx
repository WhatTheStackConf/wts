import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { getWorkspace, startDraft } from "~/lib/cfp-actions";
import type { FieldIssue, Workspace } from "~/lib/cfp-model";
import { ErrorNotice } from "~/components/ApplicantUI";

export default function Applications() {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = createSignal<Workspace>();
  const [error, setError] = createSignal<{ message: string; code: string; issues: FieldIssue[] }>();
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

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
    <header class="page-heading"><h1>Your applications</h1><p>Review your saved applications and continue active drafts.</p></header>
    <Switch>
      <Match when={loading()}><div class="cfp-loading" role="status">Loading your applicant dashboard…</div></Match>
      <Match when={error()}><ErrorNotice message={error()?.message} issues={error()?.issues} onRetry={() => void load()} /><Show when={error()?.code === "unauthenticated"}><a class="button" href="/auth/login?returnTo=%2Fapplications" rel="external">Sign in to continue</a></Show></Match>
      <Match when={workspace()}>
        <section class="surface cfp-stack" aria-labelledby="application-actions-title">
          <div class="surface-title"><div><h2 id="application-actions-title">Start an application</h2><p>{workspace()?.cfpOpen ? "Create a blank presentation draft or resume saved work." : "The CFP is closed. You can still read your applications and update your profile or settings."}</p></div>
            <span class="cfp-status" data-state={workspace()?.cfpOpen ? "active" : "closed"}>{workspace()?.cfpOpen ? "Open" : "Closed"}</span>
          </div>
          <Show when={workspace()?.cfpOpen}><button type="button" class="button" disabled={busy()} onClick={() => void begin({ kind: "new" })}>{busy() ? "Creating draft…" : "New application"}</button></Show>
          <div class="row"><a href="/profile">Edit speaker profile</a><a href="/settings">Edit applicant settings</a></div>
        </section>
        <section class="surface cfp-stack" aria-labelledby="draft-list-title">
          <div class="surface-title"><div><h2 id="draft-list-title">Active drafts</h2><p>Your draft values save before each step changes.</p></div></div>
          <Show when={workspace()!.drafts.length} fallback={<p class="empty-state">You have no active drafts.</p>}>
            <ul class="cfp-list"><For each={workspace()!.drafts}>{(draft) => <li class="list-item"><div><h3>{draft.title || "Untitled application"}</h3><p class="mono">Updated {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(draft.updatedAt)}</p></div><a class="button button-secondary button-small" href={`/apply/${draft.id}`}>Continue draft</a></li>}</For></ul>
          </Show>
        </section>
        <section class="surface cfp-stack" aria-labelledby="application-list-title">
          <div class="surface-title"><div><h2 id="application-list-title">Submitted applications</h2><p>Each submission has its own presentation and review status.</p></div></div>
          <Show when={workspace()!.applications.length} fallback={<p class="empty-state">Your submitted applications will appear here.</p>}>
            <ul class="cfp-list"><For each={workspace()!.applications}>{(application) => <li class="list-item"><div><h3>{application.title || "Untitled talk"}</h3><p class="mono">Submitted {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(application.submittedAt)} · revision {application.revision}</p></div><div class="row"><span class="cfp-status" data-state={application.status}>{application.status}</span><a class="button button-secondary button-small" href={`/applications/${application.id}`}>View application</a></div></li>}</For></ul>
          </Show>
        </section>
        <Show when={!workspace()?.cfpOpen}><div class="alert" role="status">New drafts, draft changes, pending edits, and submissions are unavailable while the CFP is closed. Reads and profile maintenance remain available.</div></Show>
      </Match>
    </Switch>
  </>;
}
