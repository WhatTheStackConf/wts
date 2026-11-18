import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useParams } from "@solidjs/router";
import { executeStaffCommand, getAdminProposal, getStaffDirectory } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { AdminProposal, DecideProposalsCommand, DecisionMailRecord, StaffDirectory } from "~/lib/staff-model";
import { AdminError, AdminLoading, AdminSection, AdminStatus, STATUS_LABELS, reviewSummary, useAdminRequest } from "~/components/admin/AdminUI";

const PROTECTED_FAILURES = ["forbidden", "unauthenticated", "unavailable"];
const failureState = (code: string) => code === "conflict" ? "stale" : "unavailable";

function assignmentCommand(data: AdminProposal, reviewerId: string, active: boolean) {
  const current = data.assignments.find((assignment) => assignment.reviewerId === reviewerId);
  return {
    kind: "set-assignments" as const,
    requestId: crypto.randomUUID(),
    changes: [{
      applicationId: data.application.id,
      reviewerId,
      expectedRevision: current?.revision ?? 0,
      active,
    }],
  };
}

const DECISIONS = [["accepted", "Accept"], ["rejected", "Reject"], ["pending", "Move back to pending"]] as const;

interface DecisionPanelProps {
  proposal: AdminProposal;
  busy: boolean;
  onDecide: (status: "accepted" | "rejected" | "pending") => void;
}

// What the speaker heard. "Not selected" is the word the speaker email uses for a rejection.
const TOLD_LABELS = { accepted: "Accepted", rejected: "Not selected" } as const;
const MAIL_STATE_LABELS: Record<DecisionMailRecord["state"], string> = { queued: "queued", leased: "sending", retrying: "retrying", sent: "sent", failed: "did not send", suspended: "on hold" };

function DecisionPanel(props: DecisionPanelProps) {
  const status = () => props.proposal.application.status;
  const score = () => props.proposal.ranking.averageWeightedScore;
  const told = () => props.proposal.decisionMail;
  const speakerEmail = () => {
    const record = told();
    if (record) return `${TOLD_LABELS[record.status]}, ${MAIL_STATE_LABELS[record.state]}`;
    return status() === "pending" ? "Nothing sent" : "Not sent yet";
  };
  return <section class="surface cfp-stack decision-panel" aria-labelledby="decision-title">
    <div class="surface-title"><div><h2 id="decision-title">Decision</h2><p>The score uses reviews of the current version only.</p></div><AdminStatus state={status()} label={STATUS_LABELS[status()] ?? status()} /></div>
    <dl class="decision-facts">
      <div><dt>Score</dt><dd class="numeric">{score() === null ? "Not scored" : score()!.toFixed(2)}</dd></div>
      <div><dt>Reviews</dt><dd>{reviewSummary(props.proposal.ranking)}</dd></div>
      <div><dt>Speaker email</dt><dd>{speakerEmail()}</dd></div>
    </dl>
    <Show when={told() && told()!.status !== status()}><p class="alert" role="status">The speaker's email says {TOLD_LABELS[told()!.status]}, but the decision is now {STATUS_LABELS[status()] ?? status()}. We do not email the change. Contact the speaker yourself.</p></Show>
    <div class="row">
      <For each={DECISIONS.filter(([value]) => value !== status() && (value !== "pending" || status() !== "pending"))}>{([value, label]) =>
        <button type="button" class={value === "accepted" ? "button" : value === "rejected" ? "button button-danger" : "button button-secondary"} disabled={props.busy} onClick={() => props.onDecide(value)}>{label}</button>}</For>
    </div>
    <details class="committee-weights"><summary>Committee weights</summary>
      <p class="hint">The average weight the committee gave each criterion, from 1 to 6.</p>
      <dl class="read-only-summary"><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{props.proposal.weighting.averages[criterion]}</dd></div>}</For></dl>
    </details>
  </section>;
}

interface ApplicantContactProps {
  proposal: AdminProposal;
  recordedContact: string;
}

function ApplicantContact(props: ApplicantContactProps) {
  return <AdminSection title="Speaker">
    <dl class="read-only-summary">
      <div><dt>Name</dt><dd>{props.proposal.speaker.value.fullName}</dd></div>
      <div><dt>Affiliation</dt><dd>{props.proposal.speaker.value.affiliation || "Not provided"}</dd></div>
      <div><dt>Email at submission</dt><dd>{props.recordedContact}</dd></div>
      <div><dt>Preferred contact method</dt><dd>{props.proposal.settings.value.preferredContactMethod || "Not provided"}</dd></div>
      <div><dt>Company covers travel</dt><dd>{props.proposal.settings.value.companyCoverExpenses ?? "Not provided"}</dd></div>
      <div><dt>WTS user ID</dt><dd class="mono">{props.proposal.applicant.wtsUserId}</dd></div>
      <div class="wide"><dt>Bio</dt><dd>{props.proposal.speaker.value.bio || "Not provided"}</dd></div>
      <div class="wide"><dt>Social links</dt><dd>{props.proposal.speaker.value.socialHandles.join(", ") || "Not provided"}</dd></div>
      <div class="wide"><dt>Previous talks</dt><dd>{props.proposal.speaker.value.previousTalks || "Not provided"}</dd></div>
    </dl>
  </AdminSection>;
}

export default function AdminProposalPage() {
  const params = useParams();
  const [proposal, setProposal] = createSignal<AdminProposal>();
  const [directory, setDirectory] = createSignal<StaffDirectory>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [reviewerId, setReviewerId] = createSignal("");
  const request = useAdminRequest();

  const load = async (): Promise<boolean> => {
    setLoading(true);
    let loaded = false;
    try {
      const [proposalResult, directoryResult] = await Promise.all([getAdminProposal(params.id ?? ""), getStaffDirectory()]);
      if (proposalResult.ok && directoryResult.ok) {
        setProposal(proposalResult.value);
        setDirectory(directoryResult.value);
        request.clear();
        loaded = true;
      } else {
        const failure = !proposalResult.ok ? proposalResult.error : !directoryResult.ok ? directoryResult.error : undefined;
        if (failure) request.setError({ code: failure.code, message: failure.message });
        setProposal(undefined);
        setDirectory(undefined);
      }
    } catch {
      setProposal(undefined);
      setDirectory(undefined);
      request.setError({ code: "unavailable", message: "The proposal could not be verified. Protected CFP details are hidden." });
    }
    setLoading(false);
    return loaded;
  };
  onSettled(() => { void load(); });

  const updateAssignment = async (active: boolean) => {
    const data = proposal();
    const selectedReviewer = reviewerId();
    if (!data || !selectedReviewer || busy()) return;
    setBusy(true);
    const result = await request.run(() => executeStaffCommand(assignmentCommand(data, selectedReviewer, active)));
    if (result?.ok) {
      if (await load()) request.saved(active ? "Reviewer assignment saved." : "Reviewer assignment revoked.");
    } else if (result && PROTECTED_FAILURES.includes(result.error.code)) {
      setProposal(undefined);
      setDirectory(undefined);
    }
    setBusy(false);
  };

  const decide = async (status: "accepted" | "rejected" | "pending") => {
    const data = proposal();
    if (!data || busy()) return;
    const command: DecideProposalsCommand = {
      kind: "decide-proposals",
      requestId: crypto.randomUUID(),
      expectedWeightingRevision: data.weighting.revision,
      status,
      targets: [{
        applicationId: data.application.id,
        expectedApplicationRevision: data.application.revision,
        expectedPresentationRevision: data.presentationRevision,
        expectedAssessmentRevision: data.assessmentRevision,
      }] as DecideProposalsCommand["targets"],
    };
    setBusy(true);
    const result = await request.run(() => executeStaffCommand(command));
    if (result?.ok) {
      if (await load()) request.saved(`Decision saved: ${STATUS_LABELS[status]}.`);
    } else if (result && PROTECTED_FAILURES.includes(result.error.code)) {
      setProposal(undefined);
      setDirectory(undefined);
    }
    setBusy(false);
  };
  const reviewerName = (id: string) => {
    const name = directory()?.members.find((member) => member.wtsUserId === id)?.speakerName;
    return name ? `${name} (${id})` : id;
  };

  const eligibleReviewers = () => directory()!.members.filter((member) => member.reviewerGrant?.state === "active" && member.wtsUserId !== proposal()!.applicant.wtsUserId);
  const recordedContact = () => {
    const contact = proposal()!.applicant.contact;
    if (contact.kind === "unavailable") return "Not recorded for this older submission";
    return contact.email;
  };
  const presentation = (value: AdminProposal["application"]["presentation"]) => <dl class="read-only-summary">
    <Show when={value.title !== proposal()!.application.presentation.title}><div class="wide"><dt>Title</dt><dd>{value.title || "Not provided"}</dd></div></Show>
    <div class="wide"><dt>Abstract</dt><dd><div class="rich-html" innerHTML={value.abstract || "<p>Not provided</p>"} /></dd></div>
    <div class="wide"><dt>Key takeaways</dt><dd><div class="rich-html" innerHTML={value.keyTakeaways || "<p>Not provided</p>"} /></dd></div>
    <div class="wide"><dt>Technical requirements</dt><dd>{value.technicalRequirements || "Not provided"}</dd></div>
    <div class="wide"><dt>Previous presentation</dt><dd>{value.previousPresentation || "Not provided"}</dd></div>
    <div class="wide"><dt>Organizer notes</dt><dd>{value.organizerNotes || "Not provided"}</dd></div>
    <div class="wide"><dt>Additional information</dt><dd>{value.additionalInfo || "Not provided"}</dd></div>
  </dl>;

  return <>
    <nav aria-label="Breadcrumb"><a class="inline-link" href="/admin">Back to talk proposals</a></nav>
    <Switch>
      <Match when={loading()}><AdminLoading label="Loading the proposal and its reviews…" /></Match>
      <Match when={request.error()}>{(failure) => <Switch fallback={<AdminError state={failureState(failure().code)} message={failure().message} onRetry={() => void load()} />}>
        <Match when={failure().code === "unauthenticated"}><AdminError state="unauthenticated" message={failure().message} /></Match>
        <Match when={failure().code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected CFP details are hidden." /></Match>
        <Match when={failure().code === "not_found"}><AdminError state="not-found" message={failure().message} /></Match>
      </Switch>}</Match>
      <Match when={proposal() && directory()}>
        <header class="page-heading">
          <h1>{proposal()!.application.presentation.title || "Untitled talk"}</h1>
          <p>By {proposal()!.speaker.value.fullName || "an unnamed speaker"}</p>
        </header>
        <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>
        <Show when={request.error()}>{(failure) => <AdminError state={failureState(failure().code)} message={failure().message} onRetry={() => void load()} />}</Show>
        <section class="cfp-stack" aria-label="Talk proposal details">
          <DecisionPanel proposal={proposal()!} busy={busy()} onDecide={(status) => void decide(status)} />

          <AdminSection title="The proposal" description="The submitted version. Drafts the speaker has not submitted are not shown.">
            {presentation(proposal()!.application.presentation)}
          </AdminSection>

          <ApplicantContact proposal={proposal()!} recordedContact={recordedContact()} />

          <AdminSection title="Reviewers" description="Reviewers see only the proposals assigned to them.">
            <form class="row" onSubmit={(event) => { event.preventDefault(); void updateAssignment(true); }}>
              <label>Reviewer with an active edition grant
                <select class="control" name="reviewerId" required value={reviewerId()} onChange={(event) => setReviewerId(event.currentTarget.value)}>
                  <option value="">Choose reviewer</option>
                  <For each={eligibleReviewers()}>{(member) => <option value={member.wtsUserId}>{reviewerName(member.wtsUserId)}</option>}</For>
                </select>
              </label>
            <Show when={eligibleReviewers().length === 0}><p class="empty-state">No reviewers are available. Grant the reviewer role in Staff and gates.</p></Show>
              <button class="button" type="submit" disabled={busy()}>Assign reviewer</button>
              <button class="button button-danger" type="button" disabled={busy() || !reviewerId() || !proposal()!.assignments.some((assignment) => assignment.reviewerId === reviewerId() && assignment.state === "active")} onClick={() => void updateAssignment(false)}>Revoke assignment</button>
            </form>
            <ul class="cfp-list"><For each={proposal()!.assignments}>{(assignment) => <li class="list-item"><span>{reviewerName(assignment.reviewerId)}</span><AdminStatus state={assignment.state} label={assignment.state === "active" ? "Assigned" : "Removed"} /></li>}</For></ul>
            <Show when={proposal()!.assignments.length === 0}><p class="empty-state">No reviewers are assigned yet.</p></Show>
          </AdminSection>

          <AdminSection title="Committee reviews" description="Only admins see reviewer notes and scores.">
            <Show when={proposal()!.reviews.length} fallback={<p class="empty-state">No committee reviews have been recorded.</p>}>
              <ul class="cfp-list"><For each={proposal()!.reviews}>{(review) => <li class="list-item"><article class="cfp-stack">
                <div class="surface-title"><h3>{reviewerName(review.value.reviewerId)}</h3><AdminStatus state={review.freshness === "current" ? "active" : "pending"} label={review.freshness === "current" ? "Current version" : "Older version"} /></div>
                <dl class="read-only-summary"><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{review.value.scores[criterion]} / 5</dd></div>}</For></dl>
                <Show when={review.value.suspectedAi}><p><strong>Flagged as possibly machine-written.</strong></p></Show>
                <div><h4>Review notes</h4><p class="preserve-lines">{review.value.notes || "No notes recorded."}</p></div>
                <details><summary>Presentation evaluated by this review</summary>{presentation(review.evaluatedPresentation)}</details>
              </article></li>}</For></ul>
            </Show>
          </AdminSection>

          <AdminSection title="Decision history">
            <Show when={proposal()!.decisions.length} fallback={<p class="empty-state">No decisions have been recorded.</p>}>
              <ol class="cfp-list"><For each={proposal()!.decisions}>{(decision) => <li class="list-item"><div>
                <h3>{STATUS_LABELS[decision.previousStatus] ?? decision.previousStatus} → {STATUS_LABELS[decision.status] ?? decision.status}</h3>
                <p>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(decision.decidedAt)} · {reviewerName(decision.decidedBy)}</p>
                <p>Score at the time: {decision.ranking.averageWeightedScore === null ? "Not scored" : decision.ranking.averageWeightedScore.toFixed(2)} · {reviewSummary(decision.ranking)}</p>
              </div></li>}</For></ol>
            </Show>
          </AdminSection>
        </section>
      </Match>
    </Switch>
  </>;
}
