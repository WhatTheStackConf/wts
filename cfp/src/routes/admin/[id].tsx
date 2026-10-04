import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useParams } from "@solidjs/router";
import { executeStaffCommand, getAdminProposal, getStaffDirectory } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { AdminProposal, StaffDirectory } from "~/lib/staff-model";
import { AdminError, AdminLoading, AdminSection, AdminStatus, useAdminRequest } from "~/components/admin/AdminUI";

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
    const current = data.assignments.find((assignment) => assignment.reviewerId === selectedReviewer);
    setBusy(true);
    const result = await request.run(() => executeStaffCommand({
      kind: "set-assignments",
      requestId: crypto.randomUUID(),
      changes: [{
        applicationId: data.application.id,
        reviewerId: selectedReviewer,
        expectedRevision: current?.revision ?? 0,
        active,
      }],
    }));
    if (result?.ok) {
      if (await load()) request.saved(active ? "Reviewer assignment saved." : "Reviewer assignment revoked.");
    } else if (result && (result.error.code === "forbidden" || result.error.code === "unauthenticated" || result.error.code === "unavailable")) {
      setProposal(undefined);
      setDirectory(undefined);
    }
    setBusy(false);
  };

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
      <Match when={request.error()?.code === "unauthenticated"}><AdminError state="unauthenticated" message={request.error()?.message} /></Match>
      <Match when={request.error()?.code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected CFP details are hidden." /></Match>
      <Match when={request.error()?.code === "not_found"}><AdminError state="not-found" message={request.error()?.message} /></Match>
      <Match when={request.error() && request.error()?.code !== "forbidden" && request.error()?.code !== "unauthenticated" && request.error()?.code !== "not_found"}><AdminError state={request.error()?.code === "conflict" ? "stale" : "unavailable"} message={request.error()?.message} onRetry={() => void load()} /></Match>
      <Match when={proposal() && directory()}>
        <header class="page-heading">
          <h1>{proposal()!.application.presentation.title || "Untitled talk"}</h1>
          <p>Edition {proposal()!.editionId} · application revision {proposal()!.application.revision} · presentation revision {proposal()!.presentationRevision}</p>
          <AdminStatus state={proposal()!.application.status} label={proposal()!.application.status} />
        </header>
        <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>
        <Show when={request.error()}><AdminError state={request.error()?.code === "conflict" ? "stale" : "unavailable"} message={request.error()?.message} onRetry={() => void load()} /></Show>
        <section class="cfp-stack" aria-label="Committed CFP proposal details">
          <AdminSection title="Selection evidence" description="Every decision witness includes application, presentation, review assessment, and aggregate weighting revisions.">
            <div class="row">
              <AdminStatus state={proposal()!.application.status} label={`Status: ${proposal()!.application.status}`} />
              <span>Normalized score: {proposal()!.ranking.averageWeightedScore?.toFixed(2) ?? "Not scored"}</span>
              <span>Reviews current / stale / total: {proposal()!.ranking.currentReviewCount} / {proposal()!.ranking.staleReviewCount} / {proposal()!.ranking.totalReviewCount}</span>
              <span>Assessment revision: {proposal()!.assessmentRevision}</span>
              <span>Weighting revision: {proposal()!.weighting.revision}</span>
            </div>
            <dl class="read-only-summary"><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{proposal()!.weighting.averages[criterion]}</dd></div>}</For></dl>
          </AdminSection>

          <AdminSection title="Committed presentation" description="This is the submitted version, not an applicant draft.">
            {presentation(proposal()!.application.presentation)}
          </AdminSection>

          <AdminSection title="Applicant and recorded contact">
            <dl class="read-only-summary">
              <div><dt>WTS user ID</dt><dd>{proposal()!.applicant.wtsUserId}</dd></div>
              <div><dt>Current profile name</dt><dd>{proposal()!.speaker.value.fullName}</dd></div>
              <div><dt>Recorded contact</dt><dd>{recordedContact()}</dd></div>
              <div><dt>Current profile revision</dt><dd>{proposal()!.speaker.revision}</dd></div>
              <div class="wide"><dt>Current speaker profile</dt><dd><strong>{proposal()!.speaker.value.affiliation || "No affiliation recorded"}</strong><p>{proposal()!.speaker.value.bio || "Bio not provided"}</p><p>Social handles: {proposal()!.speaker.value.socialHandles.join(", ") || "Not recorded"}</p><p>Previous talks: {proposal()!.speaker.value.previousTalks || "Not recorded"}</p></dd></div>
              <div><dt>Current preferred contact method</dt><dd>{proposal()!.settings.value.preferredContactMethod || "Not recorded"}</dd></div>
              <div><dt>Current expense coverage</dt><dd>{proposal()!.settings.value.companyCoverExpenses ?? "Not recorded"}</dd></div>
            </dl>
          </AdminSection>

          <AdminSection title="Reviewer assignments" description="Assignments apply only to this edition and proposal.">
            <form class="row" onSubmit={(event) => { event.preventDefault(); void updateAssignment(true); }}>
              <label>Reviewer with an active edition grant
                <select class="control" name="reviewerId" required value={reviewerId()} onChange={(event) => setReviewerId(event.currentTarget.value)}>
                  <option value="">Choose reviewer</option>
                  <For each={directory()!.members.filter((member) => member.reviewerGrant?.state === "active" && member.wtsUserId !== proposal()!.applicant.wtsUserId)}>{(member) => <option value={member.wtsUserId}>{member.speakerName || "WTS user"} · {member.wtsUserId}</option>}</For>
                </select>
              </label>
            <Show when={!directory()!.members.some((member) => member.reviewerGrant?.state === "active" && member.wtsUserId !== proposal()!.applicant.wtsUserId)}><p class="empty-state">No other known WTS identity has an active reviewer grant.</p></Show>
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
