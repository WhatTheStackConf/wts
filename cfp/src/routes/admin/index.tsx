import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { AdminError, AdminLoading, AdminSection, AdminStatus, STATUS_LABELS, reviewSummary, useAdminRequest, type AdminFailureState } from "~/components/admin/AdminUI";
import { getAdminWorkspace, executeStaffCommand } from "~/lib/staff-actions";
import type { AdminQuery, AdminWorkspace, AdminProposalSummary, DecideProposalsCommand } from "~/lib/staff-model";

const PAGE_SIZE = 50;

type SelectedTarget = Pick<AdminProposalSummary, "applicationId" | "applicationRevision" | "presentationRevision" | "assessmentRevision" | "status" | "title">;

const FAILURE_STATES = new Map<string, AdminFailureState>([["last_admin", "last-admin"], ["not_found", "not-found"], ["conflict", "stale"]]);

interface EditionStateProps {
  workspace: AdminWorkspace;
}

function EditionState(props: EditionStateProps) {
  const mail = () => props.workspace.mail;
  const mailProblem = () => !mail().configured ? "Emails to speakers are not sending, because mail is not configured."
    : mail().failed + mail().suspended + mail().deliveryUnknown > 0 ? `${mail().failed + mail().suspended + mail().deliveryUnknown} emails did not send.`
    : undefined;
  return <div class="cfp-stack">
    <div class="row admin-gates" aria-label="Edition state">
      <AdminStatus state={props.workspace.cfpGate.open ? "active" : "closed"} label={`Submissions ${props.workspace.cfpGate.open ? "open" : "closed"}`} />
      <AdminStatus state={props.workspace.reviewPolicy.reviewOpen ? "active" : "closed"} label={`Reviews ${props.workspace.reviewPolicy.reviewOpen ? "open" : "closed"}`} />
      <a class="inline-link" href="/admin/staff">Change in Staff and gates</a>
    </div>
    <Show when={mailProblem()}>{(message) => <div class="alert" role="status"><p>{message()} <a class="inline-link" href="/admin/staff">Check mail</a></p></div>}</Show>
  </div>;
}

interface DecisionEmailsProps {
  summary: AdminWorkspace["decisionMail"];
  busy: boolean;
  message: string;
  onSend: () => void;
}

// Decisions stay private until an organizer sends them. Each proposal gets one decision email.
function DecisionEmails(props: DecisionEmailsProps) {
  const [confirming, setConfirming] = createSignal(false);
  const emails = () => `${props.summary.unsent} ${props.summary.unsent === 1 ? "email" : "emails"}`;
  return <section class="surface cfp-stack decision-mail" aria-labelledby="decision-mail-title">
    <div class="surface-title"><div><h2 id="decision-mail-title">Decision emails</h2><p>Speakers hear nothing about accept or reject until you send these.</p></div></div>
    <Show when={props.summary.unsent > 0} fallback={<p>Every decided proposal has its email.</p>}>
      <Show when={confirming()} fallback={<div class="row">
        <p>{props.summary.unsent} decided {props.summary.unsent === 1 ? "proposal has" : "proposals have"} no email yet.</p>
        <button class="button" type="button" disabled={props.busy} onClick={() => setConfirming(true)}>Send decision emails</button>
      </div>}>
        <div class="cfp-stack decision-confirm" role="group" aria-label="Confirm decision emails">
          <p><strong>Send {emails()}?</strong> Speakers see the decision right away, and you cannot take an email back. A later change sends no new email.</p>
          <div class="row">
            <button class="button" type="button" disabled={props.busy} onClick={() => { setConfirming(false); props.onSend(); }}>{props.busy ? "Sending…" : `Send ${emails()}`}</button>
            <button class="button button-secondary" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      </Show>
    </Show>
    <Show when={props.message}><p class="alert" role="status">{props.message}</p></Show>
    <Show when={props.summary.changed > 0}><p class="alert" role="status">{props.summary.changed} {props.summary.changed === 1 ? "decision no longer matches its" : "decisions no longer match their"} email. We do not email the change. Open each proposal and contact the speaker yourself.</p></Show>
  </section>;
}

interface ProposalFiltersProps {
  query: AdminQuery;
  onChange: (patch: Partial<AdminQuery>) => void;
  onApply: (patch: Partial<AdminQuery>) => void;
  onSubmit: (event: SubmitEvent) => void;
}

function ProposalFilters(props: ProposalFiltersProps) {
  return <form class="cfp-stack admin-filters" onSubmit={props.onSubmit} aria-label="Filter proposals">
    <div class="admin-filter-grid">
      <label>Search title or applicant
        <input class="control" name="search" type="search" maxlength={500} value={props.query.search ?? ""} onInput={(event) => props.onChange({ search: event.currentTarget.value || undefined })} />
      </label>
      <label>Expense coverage
        <select class="control" name="expenseCoverage" value={props.query.expenseCoverage ?? "all"} onChange={(event) => props.onApply({ expenseCoverage: event.currentTarget.value === "all" ? undefined : event.currentTarget.value as AdminQuery["expenseCoverage"] })}>
          <option value="all">Any</option><option value="Yes">Yes</option><option value="No">No</option><option value="Other">Other</option>
        </select>
      </label>
      <label>Review state
        <select class="control" name="reviewState" value={props.query.reviewState ?? "all"} onChange={(event) => props.onApply({ reviewState: event.currentTarget.value as AdminQuery["reviewState"] })}>
          <option value="all">All</option><option value="unreviewed">Not reviewed</option><option value="current">Reviewed</option><option value="stale">Changed since review</option>
        </select>
      </label>
      <label>Sort by
        <select class="control" name="sort" value={props.query.sort ?? "score"} onChange={(event) => props.onApply({ sort: event.currentTarget.value as AdminQuery["sort"] })}>
          <option value="score">Score</option><option value="submitted">Submission time</option><option value="title">Title</option><option value="review-count">Review count</option>
        </select>
      </label>
      <button class="button button-secondary" type="submit">Search</button>
    </div>
  </form>;
}

export default function AdminWorkspacePage() {
  const [query, setQuery] = createSignal<AdminQuery>({ status: "pending", sort: "score", page: 1, pageSize: PAGE_SIZE });
  const [workspace, setWorkspace] = createSignal<AdminWorkspace>();
  const [selected, setSelected] = createSignal<SelectedTarget[]>([]);
  const [pendingDecision, setPendingDecision] = createSignal<DecideProposalsCommand>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal<"accepted" | "rejected" | "pending">();
  const request = useAdminRequest();

  const [sentMessage, setSentMessage] = createSignal("");
  const load = async (requestedQuery = query()): Promise<boolean> => {
    setLoading(true);
    setSentMessage("");
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
      if (await load()) request.saved(`Updated ${result.value.result.length} ${result.value.result.length === 1 ? "proposal" : "proposals"}.`);
    } else {
      if (result && result.error.code !== "unavailable") setPendingDecision(undefined);
      setWorkspace(undefined);
      setSelected([]);
    }
    setBusy(false);
  };

  // One request ID per send attempt, so a retry after a lost response cannot queue twice.
  const [pendingSend, setPendingSend] = createSignal<string>();
  const sendDecisionEmails = async () => {
    if (busy()) return;
    const requestId = pendingSend() ?? crypto.randomUUID();
    setPendingSend(requestId);
    setBusy(true);
    const result = await request.run(() => executeStaffCommand({ kind: "send-decision-emails", requestId }));
    setBusy(false);
    if (!result?.ok) { if (result && result.error.code !== "unavailable") setPendingSend(undefined); return; }
    setPendingSend(undefined);
    const { queued, withoutAddress } = result.value.result;
    const missing = withoutAddress ? ` ${withoutAddress} ${withoutAddress === 1 ? "proposal has" : "proposals have"} no recorded email address.` : "";
    if (await load()) setSentMessage(`Queued ${queued} decision ${queued === 1 ? "email" : "emails"}.${missing}`);
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

  const applyFilter = (patch: Partial<AdminQuery>) => { void load(changeQuery(patch)); };
  const STATUS_TABS = [["pending", "Pending"], ["accepted", "Accepted"], ["rejected", "Rejected"], ["all", "All"]] as const;
  const tabCount = (status: string) => {
    const counts = workspace()!.counts;
    return status === "all" ? counts.pending + counts.accepted + counts.rejected : counts[status as "pending" | "accepted" | "rejected"];
  };
  const DECISION_COPY = { accepted: ["Accept", "Confirm accept"], rejected: ["Reject", "Confirm reject"], pending: ["Move back to pending", "Confirm move"] } as const;
  const confirmDecision = async () => {
    const status = confirming();
    if (!status) return;
    await decide(status);
    setConfirming(undefined);
  };

  const submitFilters = (event: SubmitEvent) => {
    event.preventDefault();
    void load();
  };

  return <>
    <header class="page-heading">
      <h1>CFP administration</h1>
      <p>Decide on talk proposals. Open a proposal to read it and its reviews.</p>
    </header>
    <nav class="staff-subnav" aria-label="CFP administration">
      <a href="/admin" aria-current="page">Proposals</a>
      <a href="/admin/staff">Staff and gates</a>
    </nav>
    <Switch>
      <Match when={loading()}><AdminLoading label="Loading CFP administration…" /></Match>
      <Match when={request.error()}>{(failure) => <Switch fallback={<>
        <AdminError state={FAILURE_STATES.get(failure().code) ?? "unavailable"} message={failure().message} onRetry={() => void load()} />
        <Show when={pendingDecision() && failure().code === "unavailable"}><button class="button" type="button" disabled={busy()} onClick={() => void submitDecision(pendingDecision()!)}>Retry the exact decision request</button></Show>
        <Show when={pendingSend() && failure().code === "unavailable"}><button class="button" type="button" disabled={busy()} onClick={() => void sendDecisionEmails()}>Retry sending decision emails</button></Show>
      </>}>
        <Match when={failure().code === "unauthenticated"}><AdminError state="unauthenticated" message={failure().message} /></Match>
        <Match when={failure().code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected CFP data is hidden." /></Match>
      </Switch>}</Match>
      <Match when={workspace()}>
        <div class="cfp-stack">
          <EditionState workspace={workspace()!} />
          <Show when={workspace()!.counts.accepted + workspace()!.counts.rejected > 0}>
            <DecisionEmails summary={workspace()!.decisionMail} busy={busy()} message={sentMessage()} onSend={() => void sendDecisionEmails()} />
          </Show>

          <AdminSection title="Talk proposals">
            <div class="status-tabs" role="group" aria-label="Status">
              <For each={STATUS_TABS}>{([value, label]) => <button type="button" class="status-tab" aria-pressed={(query().status ?? "pending") === value ? "true" : "false"} onClick={() => { setSelected([]); setConfirming(undefined); applyFilter({ status: value }); }}>{label} <span class="status-tab-count">{tabCount(value)}</span></button>}</For>
            </div>
            <ProposalFilters query={query()} onChange={changeQuery} onApply={applyFilter} onSubmit={submitFilters} />
            <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>

            <Show when={pendingDecision() && !busy()}><p class="alert" role="status">The last decision did not confirm. Retry the same request before you make another decision. <button class="button button-secondary button-small" type="button" disabled={busy()} onClick={() => void submitDecision(pendingDecision()!)}>Retry exact decision</button></p></Show>
            <div class="row row-between">
              <p>{workspace()!.total} {workspace()!.total === 1 ? "proposal" : "proposals"}<Show when={workspace()!.total > workspace()!.pageSize}> · page {workspace()!.page}</Show></p>
              <Show when={workspace()!.total > workspace()!.pageSize}><div class="row">
                <button class="button button-secondary button-small" type="button" disabled={workspace()!.page <= 1 || loading()} onClick={() => void load(changeQuery({ page: workspace()!.page - 1 }))}>Previous page</button>
                <button class="button button-secondary button-small" type="button" disabled={workspace()!.page * workspace()!.pageSize >= workspace()!.total || loading()} onClick={() => void load(changeQuery({ page: workspace()!.page + 1 }))}>Next page</button>
              </div></Show>
            </div>
            <Show when={selected().length > 0}>
              <fieldset class="cfp-stack decision-bar" disabled={busy() || Boolean(pendingDecision())}>
                <legend>{selected().length} selected</legend>
                <Show when={confirming()} fallback={<div class="row">
                  <button class="button" type="button" onClick={() => setConfirming("accepted")}>Accept selected</button>
                  <button class="button button-danger" type="button" onClick={() => setConfirming("rejected")}>Reject selected</button>
                  <Show when={selected().some((item) => item.status !== "pending")}><button class="button button-secondary" type="button" onClick={() => setConfirming("pending")}>Reopen selected to pending</button></Show>
                  <button class="button button-quiet" type="button" onClick={() => setSelected([])}>Clear selection</button>
                </div>}>{(status) => <div class="cfp-stack decision-confirm" role="group" aria-label="Confirm decision">
                  <p><strong>{DECISION_COPY[status()][0]} {selected().length} {selected().length === 1 ? "proposal" : "proposals"}?</strong> If one of them changed since you selected it, nothing changes.</p>
                  <ul class="decision-list"><For each={selected()}>{(item) => <li>{item.title || "Untitled talk"}</li>}</For></ul>
                  <div class="row">
                    <button class={status() === "rejected" ? "button button-danger" : "button"} type="button" onClick={() => void confirmDecision()}>{busy() ? "Saving…" : DECISION_COPY[status()][1]}</button>
                    <button class="button button-secondary" type="button" onClick={() => setConfirming(undefined)}>Cancel</button>
                  </div>
                </div>}</Show>
              </fieldset>
            </Show>
            <Show when={workspace()!.proposals.length} fallback={<p class="empty-state">No proposals match these filters.</p>}>
              <div class="admin-table-wrapper" tabindex="0" role="region" aria-label="Scrollable proposal results">
                <table class="table min-w-[70rem] admin-table">
                  <caption class="sr-only">Talk proposals with status, score and reviews</caption>
                  <thead><tr><th><span class="sr-only">Select</span></th><th>Proposal</th><th>Speaker</th><th>Status</th><th>Score</th><th>Reviews</th><th>Company covers travel</th><th>Submitted</th></tr></thead>
                  <tbody><For each={workspace()!.proposals}>{(row) => <tr>
                    <td><label class="table-select"><input type="checkbox" class="checkbox" aria-label={`Select ${row.title || "Untitled talk"}`} checked={selected().some((item) => item.applicationId === row.applicationId)} disabled={Boolean(pendingDecision()) || (!selected().some((item) => item.applicationId === row.applicationId) && selected().length >= 100)} onChange={(event) => toggle(row, event.currentTarget.checked)} /></label></td>
                    <th><a href={`/admin/${row.applicationId}`}>{row.title || "Untitled talk"}</a></th>
                    <td data-label="Speaker">{row.applicantName}</td>
                    <td data-label="Status"><AdminStatus state={row.status} label={STATUS_LABELS[row.status] ?? row.status} /></td>
                    <td data-label="Score" class="numeric">{row.ranking.averageWeightedScore === null ? "Not scored" : row.ranking.averageWeightedScore.toFixed(2)}</td>
                    <td data-label="Reviews">{reviewSummary(row.ranking)}</td>
                    <td data-label="Company covers travel">{row.expenseCoverage ?? "Not recorded"}</td>
                    <td data-label="Submitted">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(row.submittedAt)}</td>
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
