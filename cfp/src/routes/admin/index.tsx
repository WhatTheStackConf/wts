import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { AdminError, AdminLoading, AdminSection, AdminStatus, useAdminRequest } from "~/components/admin/AdminUI";
import { getAdminWorkspace, executeStaffCommand } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { AdminQuery, AdminWorkspace, AdminProposalSummary, DecideProposalsCommand } from "~/lib/staff-model";

const PAGE_SIZE = 50;

type SelectedTarget = Pick<AdminProposalSummary, "applicationId" | "applicationRevision" | "presentationRevision" | "assessmentRevision" | "status" | "title">;

export default function AdminWorkspacePage() {
  const [query, setQuery] = createSignal<AdminQuery>({ status: "pending", sort: "score", page: 1, pageSize: PAGE_SIZE });
  const [workspace, setWorkspace] = createSignal<AdminWorkspace>();
  const [selected, setSelected] = createSignal<SelectedTarget[]>([]);
  const [pendingDecision, setPendingDecision] = createSignal<DecideProposalsCommand>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const request = useAdminRequest();

  const load = async (requestedQuery = query()): Promise<boolean> => {
    setLoading(true);
    const result = await request.run(() => getAdminWorkspace(requestedQuery));
    let loaded = false;
    if (result?.ok) {
      setWorkspace(result.value);
      request.clear();
      loaded = true;
    } else {
      setWorkspace(undefined);
      setSelected([]);
    }
    setLoading(false);
    return loaded;
  };

  onSettled(() => { void load(); });

  const changeQuery = (patch: Partial<AdminQuery>) => {
    const next = { ...query(), ...patch, page: patch.page ?? 1 };
    setQuery(next);
    return next;
  };
  const toggle = (row: AdminProposalSummary, checked: boolean) => {
    const target: SelectedTarget = {
      applicationId: row.applicationId,
      applicationRevision: row.applicationRevision,
      presentationRevision: row.presentationRevision,
      assessmentRevision: row.assessmentRevision,
      status: row.status,
      title: row.title,
    };
    setSelected((current) => checked
      ? current.some((item) => item.applicationId === target.applicationId) ? current : [...current, target]
      : current.filter((item) => item.applicationId !== target.applicationId));
  };
  const submitDecision = async (payload: DecideProposalsCommand) => {
    if (busy()) return;
    setBusy(true);
    const result = await request.run(() => executeStaffCommand(payload));
    if (result?.ok) {
      setPendingDecision(undefined);
      setSelected([]);
      if (await load()) request.saved(`Updated ${result.value.result.length} proposal${result.value.result.length === 1 ? "" : "s"}.`);
    } else {
      if (result && result.error.code !== "unavailable") setPendingDecision(undefined);
      setWorkspace(undefined);
      setSelected([]);
    }
    setBusy(false);
  };

  const decide = async (status: "accepted" | "rejected" | "pending") => {
    if (!workspace() || !selected().length || busy()) return;
    const currentTargets = selected().map((row) => ({
      applicationId: row.applicationId,
      expectedApplicationRevision: row.applicationRevision,
      expectedPresentationRevision: row.presentationRevision,
      expectedAssessmentRevision: row.assessmentRevision,
    }));
    let payload = pendingDecision();
    if (!payload || payload.status !== status || JSON.stringify(payload.targets) !== JSON.stringify(currentTargets)) {
      payload = {
        kind: "decide-proposals",
        requestId: crypto.randomUUID(),
        expectedWeightingRevision: workspace()!.weighting.revision,
        status,
        targets: currentTargets as DecideProposalsCommand["targets"],
      };
      setPendingDecision(payload);
    }
    await submitDecision(payload);
  };

  const submitFilters = (event: SubmitEvent) => {
    event.preventDefault();
    void load();
  };

  return <>
    <header class="page-heading">
      <h1>CFP administration</h1>
      <p>Manage committee decisions and staff access for the active conference edition.</p>
      <Show when={workspace()}>
        <p class="mono" aria-label="Conference edition">Edition <strong>{workspace()?.editionId}</strong></p>
      </Show>
    </header>
    <nav class="row" aria-label="CFP administration">
      <a class="button button-secondary button-small" href="/admin" aria-current="page">Proposals</a>
      <a class="button button-secondary button-small" href="/admin/staff">Staff and gates</a>
    </nav>
    <Switch>
      <Match when={loading()}><AdminLoading label="Loading CFP administration…" /></Match>
      <Match when={request.error()?.code === "unauthenticated"}><AdminError state="unauthenticated" message={request.error()?.message} /></Match>
      <Match when={request.error()?.code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected CFP data is hidden." /></Match>
      <Match when={request.error() && request.error()?.code !== "forbidden" && request.error()?.code !== "unauthenticated"}>
        <AdminError state={request.error()?.code === "last_admin" ? "last-admin" : request.error()?.code === "not_found" ? "not-found" : request.error()?.code === "conflict" ? "stale" : "unavailable"} message={request.error()?.message} onRetry={() => void load()} />
        <Show when={pendingDecision() && request.error()?.code === "unavailable"}><button class="button" type="button" disabled={busy()} onClick={() => void submitDecision(pendingDecision()!)}>Retry the exact decision request</button></Show>
      </Match>
      <Match when={workspace()}>
        <div class="cfp-stack">
          <section class="surface cfp-stack" aria-labelledby="edition-state-heading">
            <div class="surface-title"><div><h2 id="edition-state-heading">{workspace()!.editionId} operating state</h2><p>Application intake and review access are independent edition controls.</p></div></div>
            <div class="row">
              <AdminStatus state={workspace()!.cfpGate.open ? "active" : "closed"} label={`CFP ${workspace()!.cfpGate.open ? "open" : "closed"}`} />
              <AdminStatus state={workspace()!.reviewPolicy.reviewOpen ? "active" : "closed"} label={`Reviews ${workspace()!.reviewPolicy.reviewOpen ? "open" : "closed"}`} />
              <span>Current weight votes: {workspace()!.weighting.voteCount}</span>
              <span>Daily report: {workspace()!.reviewPolicy.dailyReport.enabled ? `enabled at ${workspace()!.reviewPolicy.dailyReport.localSendTime} UTC` : "disabled"}</span>
            </div>
            <div class="cfp-stack">
              <h3>Mail queue counts</h3>
              <dl class="read-only-summary">
                <div><dt>Mode</dt><dd>{workspace()!.mail.mode}{workspace()!.mail.configured ? " · configured" : " · not configured"}</dd></div>
                <div><dt>Queued</dt><dd>{workspace()!.mail.queued}</dd></div>
                <div><dt>Retrying</dt><dd>{workspace()!.mail.retrying}</dd></div>
                <div><dt>Sent</dt><dd>{workspace()!.mail.sent}</dd></div>
                <div><dt>Failed</dt><dd>{workspace()!.mail.failed}</dd></div>
                <div><dt>Suspended</dt><dd>{workspace()!.mail.suspended}</dd></div>
                <div><dt>Delivery unknown</dt><dd>{workspace()!.mail.deliveryUnknown}</dd></div>
                <div><dt>Eligible daily recipients</dt><dd>{workspace()!.mail.eligibleDailyRecipientCount}</dd></div>
              </dl>
            </div>
          </section>

          <AdminSection title="Proposal ranking" description="Normalized scores use current-presentation reviews only. Stale and total review counts remain visible.">
            <dl class="read-only-summary">
              <div><dt>Pending</dt><dd>{workspace()!.counts.pending}</dd></div>
              <div><dt>Accepted</dt><dd>{workspace()!.counts.accepted}</dd></div>
              <div><dt>Rejected</dt><dd>{workspace()!.counts.rejected}</dd></div>
              <For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{workspace()!.weighting.averages[criterion]}</dd></div>}</For>
            </dl>
            <form class="cfp-stack" onSubmit={submitFilters} aria-label="Filter proposals">
              <div class="row">
                <label>Status
                  <select class="control" name="status" value={query().status ?? "pending"} onChange={(event) => changeQuery({ status: event.currentTarget.value as AdminQuery["status"] })}>
                    <option value="pending">Pending</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="all">All statuses</option>
                  </select>
                </label>
                <label>Search title or applicant
                  <input class="control" name="search" type="search" maxlength={500} value={query().search ?? ""} onInput={(event) => changeQuery({ search: event.currentTarget.value || undefined })} />
                </label>
                <label>Expense coverage
                  <select class="control" name="expenseCoverage" value={query().expenseCoverage ?? "all"} onChange={(event) => changeQuery({ expenseCoverage: event.currentTarget.value === "all" ? undefined : event.currentTarget.value as AdminQuery["expenseCoverage"] })}>
                    <option value="all">Any</option><option value="Yes">Yes</option><option value="No">No</option><option value="Other">Other</option>
                  </select>
                </label>
                <label>Review state
                  <select class="control" name="reviewState" value={query().reviewState ?? "all"} onChange={(event) => changeQuery({ reviewState: event.currentTarget.value as AdminQuery["reviewState"] })}>
                    <option value="all">All</option><option value="unreviewed">Unreviewed</option><option value="current">Current review</option><option value="stale">Stale review</option>
                  </select>
                </label>
                <label>Sort by
                  <select class="control" name="sort" value={query().sort ?? "score"} onChange={(event) => changeQuery({ sort: event.currentTarget.value as AdminQuery["sort"] })}>
                    <option value="score">Normalized score</option><option value="submitted">Submission time</option><option value="title">Title</option><option value="review-count">Review count</option>
                  </select>
                </label>
                <button class="button button-secondary" type="submit">Apply filters</button>
              </div>
            </form>
            <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>
            
            <Show when={pendingDecision() && !busy()}><p class="alert" role="status">A decision response was uncertain. Retry the same saved request before you start another bulk decision. Request ID: {pendingDecision()?.requestId} <button class="button button-secondary button-small" type="button" disabled={busy()} onClick={() => void submitDecision(pendingDecision()!)}>Retry exact decision</button></p></Show>
            <div class="row row-between">
              <p>{workspace()!.total} proposals · page {workspace()!.page}</p>
              <div class="row">
                <button class="button button-secondary button-small" type="button" disabled={workspace()!.page <= 1 || loading()} onClick={() => void load(changeQuery({ page: workspace()!.page - 1 }))}>Previous page</button>
                <button class="button button-secondary button-small" type="button" disabled={workspace()!.page * workspace()!.pageSize >= workspace()!.total || loading()} onClick={() => void load(changeQuery({ page: workspace()!.page + 1 }))}>Next page</button>
              </div>
            </div>
            <Show when={selected().length > 0}>
              <fieldset class="cfp-stack" disabled={busy() || Boolean(pendingDecision())}>
                <legend>Selected proposals ({selected().length}/100)</legend>
                <p>One stale target prevents the entire batch from changing. Each selected proposal stays in this list across pages.</p>
                <ul><For each={selected()}>{(item) => <li>{item.title} · {item.status} · application {item.applicationRevision} · presentation {item.presentationRevision} · assessment {item.assessmentRevision}</li>}</For></ul>
                <div class="row">
                  <button class="button" type="button" onClick={() => void decide("accepted")}>{busy() ? "Saving…" : "Accept selected"}</button>
                  <button class="button button-secondary" type="button" onClick={() => void decide("rejected")}>Reject selected</button>
                  <button class="button button-secondary" type="button" disabled={!selected().some((item) => item.status !== "pending")} onClick={() => void decide("pending")}>Reopen selected to pending</button>
                  <button class="button button-quiet" type="button" onClick={() => setSelected([])}>Clear selection</button>
                </div>
              </fieldset>
            </Show>
            <Show when={workspace()!.proposals.length} fallback={<p class="empty-state">No proposals match these filters.</p>}>
              <div class="overflow-x-auto" tabindex="0" aria-label="Scrollable proposal results">
                <table class="table table-zebra min-w-[70rem]">
                  <caption class="sr-only">CFP proposals, review evidence, and decisions</caption>
                  <thead><tr><th><span class="sr-only">Select</span></th><th>Proposal</th><th>Applicant</th><th>Status</th><th>Normalized score</th><th>Reviews current / stale / total</th><th>Expenses</th><th>Submitted</th></tr></thead>
                  <tbody><For each={workspace()!.proposals}>{(row) => <tr>
                    <td><input type="checkbox" class="checkbox" aria-label={`Select ${row.title || "Untitled talk"}`} checked={selected().some((item) => item.applicationId === row.applicationId)} disabled={Boolean(pendingDecision()) || (!selected().some((item) => item.applicationId === row.applicationId) && selected().length >= 100)} onChange={(event) => toggle(row, event.currentTarget.checked)} /></td>
                    <th><a href={`/admin/${row.applicationId}`}>{row.title || "Untitled talk"}</a><p class="mono">{row.applicationId}</p></th>
                    <td>{row.applicantName}<br /><span class="mono">{row.applicantId}</span></td>
                    <td><AdminStatus state={row.status} label={row.status} /></td>
                    <td>{row.ranking.averageWeightedScore === null ? "Not scored" : row.ranking.averageWeightedScore.toFixed(2)}<br /><span class="mono">assessment {row.assessmentRevision}</span></td>
                    <td>{row.ranking.currentReviewCount} / {row.ranking.staleReviewCount} / {row.ranking.totalReviewCount}</td>
                    <td>{row.expenseCoverage ?? "Not recorded"}</td>
                    <td>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(row.submittedAt)}</td>
                  </tr>}</For></tbody>
                </table>
              </div>
            </Show>
          </AdminSection>
        </div>
      </Match>
    </Switch>
  </>;
}
