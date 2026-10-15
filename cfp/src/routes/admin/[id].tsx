import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useParams } from "@solidjs/router";
import { executeStaffCommand, getAdminProposal, getStaffDirectory } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { AdminProposal, StaffDirectory } from "~/lib/staff-model";
import { AdminError, AdminLoading, AdminSection, AdminStatus, useAdminRequest } from "~/components/admin/AdminUI";

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

interface SelectionEvidenceProps {
  proposal: AdminProposal;
}

function SelectionEvidence(props: SelectionEvidenceProps) {
  return <AdminSection title="Selection evidence" description="Every decision witness includes application, presentation, review assessment, and aggregate weighting revisions.">
    <div class="row">
      <AdminStatus state={props.proposal.application.status} label={`Status: ${props.proposal.application.status}`} />
      <span>Normalized score: {props.proposal.ranking.averageWeightedScore?.toFixed(2) ?? "Not scored"}</span>
      <span>Reviews current / stale / total: {props.proposal.ranking.currentReviewCount} / {props.proposal.ranking.staleReviewCount} / {props.proposal.ranking.totalReviewCount}</span>
      <span>Assessment revision: {props.proposal.assessmentRevision}</span>
      <span>Weighting revision: {props.proposal.weighting.revision}</span>
    </div>
    <dl class="read-only-summary"><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{props.proposal.weighting.averages[criterion]}</dd></div>}</For></dl>
  </AdminSection>;
}

interface ApplicantContactProps {
  proposal: AdminProposal;
  recordedContact: string;
}

function ApplicantContact(props: ApplicantContactProps) {
  return <AdminSection title="Applicant and recorded contact">
    <dl class="read-only-summary">
      <div><dt>WTS user ID</dt><dd>{props.proposal.applicant.wtsUserId}</dd></div>
      <div><dt>Current profile name</dt><dd>{props.proposal.speaker.value.fullName}</dd></div>
      <div><dt>Recorded contact</dt><dd>{props.recordedContact}</dd></div>
      <div><dt>Current profile revision</dt><dd>{props.proposal.speaker.revision}</dd></div>
      <div class="wide"><dt>Current speaker profile</dt><dd><strong>{props.proposal.speaker.value.affiliation || "No affiliation recorded"}</strong><p>{props.proposal.speaker.value.bio || "Bio not provided"}</p><p>Social handles: {props.proposal.speaker.value.socialHandles.join(", ") || "Not recorded"}</p><p>Previous talks: {props.proposal.speaker.value.previousTalks || "Not recorded"}</p></dd></div>
      <div><dt>Current preferred contact method</dt><dd>{props.proposal.settings.value.preferredContactMethod || "Not recorded"}</dd></div>
      <div><dt>Current expense coverage</dt><dd>{props.proposal.settings.value.companyCoverExpenses ?? "Not recorded"}</dd></div>
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

  const eligibleReviewers = () => directory()!.members.filter((member) => member.reviewerGrant?.state === "active" && member.wtsUserId !== proposal()!.applicant.wtsUserId);
  const recordedContact = () => {
    const contact = proposal()!.applicant.contact;
    if (contact.kind === "unavailable") return "Unavailable for this historical submission";
    return `${contact.email} · recorded ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(contact.recordedAt)}`;
  };
  const presentation = (value: AdminProposal["application"]["presentation"]) => <dl class="read-only-summary">
    <div class="wide"><dt>Title</dt><dd>{value.title || "Not provided"}</dd></div>
    <div class="wide"><dt>Abstract</dt><dd><div class="rich-html" innerHTML={value.abstract || "<p>Not provided</p>"} /></dd></div>
    <div class="wide"><dt>Key takeaways</dt><dd><div class="rich-html" innerHTML={value.keyTakeaways || "<p>Not provided</p>"} /></dd></div>
    <div class="wide"><dt>Technical requirements</dt><dd>{value.technicalRequirements || "Not provided"}</dd></div>
    <div class="wide"><dt>Previous presentation</dt><dd>{value.previousPresentation || "Not provided"}</dd></div>
    <div class="wide"><dt>Organizer notes</dt><dd>{value.organizerNotes || "Not provided"}</dd></div>
    <div class="wide"><dt>Additional information</dt><dd>{value.additionalInfo || "Not provided"}</dd></div>
  </dl>;

  return <>
    <nav aria-label="Breadcrumb"><a class="inline-link" href="/admin">Back to CFP proposals</a></nav>
    <Switch>
      <Match when={loading()}><AdminLoading label="Loading committed proposal and committee context…" /></Match>
      <Match when={request.error()}>{(failure) => <Switch fallback={<AdminError state={failureState(failure().code)} message={failure().message} onRetry={() => void load()} />}>
        <Match when={failure().code === "unauthenticated"}><AdminError state="unauthenticated" message={failure().message} /></Match>
        <Match when={failure().code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected CFP details are hidden." /></Match>
        <Match when={failure().code === "not_found"}><AdminError state="not-found" message={failure().message} /></Match>
      </Switch>}</Match>
      <Match when={proposal() && directory()}>
        <header class="page-heading">
          <h1>{proposal()!.application.presentation.title || "Untitled talk"}</h1>
          <p>Edition {proposal()!.editionId} · application revision {proposal()!.application.revision} · presentation revision {proposal()!.presentationRevision}</p>
          <AdminStatus state={proposal()!.application.status} label={proposal()!.application.status} />
        </header>
        <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>
        <Show when={request.error()}>{(failure) => <AdminError state={failureState(failure().code)} message={failure().message} onRetry={() => void load()} />}</Show>
        <section class="cfp-stack" aria-label="Committed CFP proposal details">
          <SelectionEvidence proposal={proposal()!} />

          <AdminSection title="Committed presentation" description="This is the submitted version, not an applicant draft.">
            {presentation(proposal()!.application.presentation)}
          </AdminSection>

          <ApplicantContact proposal={proposal()!} recordedContact={recordedContact()} />

          <AdminSection title="Reviewer assignments" description="Assignments apply only to this edition and proposal.">
            <form class="row" onSubmit={(event) => { event.preventDefault(); void updateAssignment(true); }}>
              <label>Reviewer with an active edition grant
                <select class="control" name="reviewerId" required value={reviewerId()} onChange={(event) => setReviewerId(event.currentTarget.value)}>
                  <option value="">Choose reviewer</option>
                  <For each={eligibleReviewers()}>{(member) => <option value={member.wtsUserId}>{member.speakerName || "WTS user"} · {member.wtsUserId}</option>}</For>
                </select>
              </label>
            <Show when={eligibleReviewers().length === 0}><p class="empty-state">No other known WTS identity has an active reviewer grant.</p></Show>
              <button class="button" type="submit" disabled={busy()}>Assign reviewer</button>
              <button class="button button-secondary" type="button" disabled={busy() || !reviewerId() || !proposal()!.assignments.some((assignment) => assignment.reviewerId === reviewerId() && assignment.state === "active")} onClick={() => void updateAssignment(false)}>Revoke assignment</button>
            </form>
            <ul class="cfp-list"><For each={proposal()!.assignments}>{(assignment) => <li class="list-item"><span>{assignment.reviewerId} · revision {assignment.revision}</span><AdminStatus state={assignment.state} label={assignment.state} /></li>}</For></ul>
            <Show when={proposal()!.assignments.length === 0}><p class="empty-state">No reviewer assignments exist for this proposal.</p></Show>
          </AdminSection>

          <AdminSection title="Committee reviews" description="Private reviewer notes and scores are visible to edition admins. Individual weight votes are not included.">
            <Show when={proposal()!.reviews.length} fallback={<p class="empty-state">No committee reviews have been recorded.</p>}>
              <ul class="cfp-list"><For each={proposal()!.reviews}>{(review) => <li class="list-item"><article class="cfp-stack">
                <h3>Reviewer {review.value.reviewerId}</h3>
                <AdminStatus state={review.freshness} label={`${review.freshness} review`} />
                <p>Reviewed presentation revision {review.value.presentationRevision} · review revision {review.value.revision}</p>
                <dl class="read-only-summary"><For each={Object.entries(review.value.scores)}>{([criterion, score]) => <div><dt>{criterion}</dt><dd>{score} / 5</dd></div>}</For></dl>
                <p>Suspected AI flag: {review.value.suspectedAi ? "Yes" : "No"}</p>
                <div><h4>Review notes</h4><p class="preserve-lines">{review.value.notes || "No notes recorded."}</p></div>
                <details><summary>Presentation evaluated by this review</summary>{presentation(review.evaluatedPresentation)}</details>
              </article></li>}</For></ul>
            </Show>
          </AdminSection>

          <AdminSection title="Decision history">
            <Show when={proposal()!.decisions.length} fallback={<p class="empty-state">No decisions have been recorded.</p>}>
              <ol class="cfp-list"><For each={proposal()!.decisions}>{(decision) => <li class="list-item"><div>
                <h3>{decision.previousStatus} → {decision.status}</h3>
                <p>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(decision.decidedAt)} · {decision.decidedBy}</p>
                <p>Application {decision.applicationRevisionBefore} → {decision.applicationRevisionAfter} · presentation {decision.presentationRevision} · assessment {decision.assessmentRevision} · weighting {decision.weighting.revision}</p>
                <p>Recorded normalized score {decision.ranking.averageWeightedScore === null ? "Not scored" : decision.ranking.averageWeightedScore.toFixed(2)} · current/stale/total reviews {decision.ranking.currentReviewCount}/{decision.ranking.staleReviewCount}/{decision.ranking.totalReviewCount}</p>
              </div></li>}</For></ol>
            </Show>
          </AdminSection>
        </section>
      </Match>
    </Switch>
  </>;
}
