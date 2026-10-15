import { createEffect, createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { executeStaffCommand, getNextReview, getReviewerProposal } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { OwnReview, ReviewScores, ReviewerPresentation, ReviewerProposal, ReviewerReviewState } from "~/lib/staff-model";
import { ErrorNotice } from "~/components/ApplicantUI";
import { REVIEW_STATE_LABELS } from "./review-state";

const ACCESS_DENIAL_CODES: Record<string, true> = { unauthenticated: true, forbidden: true, not_found: true, finalized: true };
function denied(error: { code: string; message: string }): boolean {
  return ACCESS_DENIAL_CODES[error.code] === true || error.code === "unavailable" && error.message.includes("identity service could not verify");
}

function hasAllScores(scores: Partial<ReviewScores>): scores is ReviewScores {
  return CRITERIA.every((criterion) => scores[criterion] !== undefined);
}

type StaleReview = Extract<ReviewerReviewState, { kind: "stale" }>;
type SaveReviewCommand = {
  requestId: string;
  kind: "save-review";
  applicationId: string;
  expectedAssignmentRevision: number;
  expectedPresentationRevision: number;
  expectedReviewRevision: number;
  scores: ReviewScores;
  notes: string;
  suspectedAi: boolean;
};

const savedReview = (proposal: ReviewerProposal) => proposal.review.kind === "unreviewed" ? undefined : proposal.review.value;
const staleReview = (proposal: ReviewerProposal | undefined) => proposal?.review.kind === "stale" ? proposal.review : undefined;

function saveReviewCommand(proposal: ReviewerProposal, scores: ReviewScores, notes: string, suspectedAi: boolean): SaveReviewCommand {
  return {
    requestId: crypto.randomUUID(),
    kind: "save-review",
    applicationId: proposal.applicationId,
    expectedAssignmentRevision: proposal.assignmentRevision,
    expectedPresentationRevision: proposal.presentationRevision,
    expectedReviewRevision: proposal.review.kind === "unreviewed" ? 0 : proposal.review.value.revision,
    scores: { ...scores },
    notes,
    suspectedAi,
  };
}

export default function ReviewerProposal() {
  const params = useParams();
  const navigate = useNavigate();
  const [proposal, setProposal] = createSignal<ReviewerProposal>();
  const [scores, setScores] = createSignal<Partial<ReviewScores>>({});
  const [notes, setNotes] = createSignal("");
  const [suspectedAi, setSuspectedAi] = createSignal(false);
  const [error, setError] = createSignal<{ code: string; message: string }>();
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [savedRevision, setSavedRevision] = createSignal<number>();
  let loadSequence = 0;
  let pendingCommand: SaveReviewCommand | undefined;

  const clearPrivate = () => {
    setProposal(undefined);
    setScores({});
    setNotes("");
    setSuspectedAi(false);
    setDirty(false);
    setSavedRevision(undefined);
    pendingCommand = undefined;
  };
  const reject = (failure: { code: string; message: string }) => {
    setError(failure);
    if (denied(failure)) clearPrivate();
  };
  const fillReviewForm = (review: OwnReview | undefined) => {
    setScores(review ? { ...review.scores } : {});
    setNotes(review?.notes ?? "");
    setSuspectedAi(review?.suspectedAi ?? false);
  };
  const errorCode = () => error()?.code;

  const load = async (applicationId = params.id ?? "") => {
    const sequence = ++loadSequence;
    setLoading(true);
    try {
      const result = await getReviewerProposal(applicationId);
      if (sequence !== loadSequence) return;
      if (result.ok) {
        setProposal(result.value);
        setError(undefined);
        if (!dirty()) fillReviewForm(savedReview(result.value));
      } else reject(result.error);
    } catch {
      if (sequence !== loadSequence) return;
      setError({ code: "unavailable", message: "The proposal could not load. Identity could not be verified." });
      clearPrivate();
    }
    setLoading(false);
  };

  createEffect(() => params.id, (applicationId) => {
    clearPrivate();
    setSaving(false);
    setError(undefined);
    void load(applicationId ?? "");
    return () => { loadSequence++; };
  });

  const formLocked = () => !proposal()!.reviewOpen || saving();
  const changed = () => {
    pendingCommand = undefined;
    setSavedRevision(undefined);
    setDirty(true);
  };
  const saveReview = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = proposal();
    if (!current || saving()) return;
    const currentScores = scores();
    if (!hasAllScores(currentScores)) return;
    pendingCommand ??= saveReviewCommand(current, currentScores, notes(), suspectedAi());
    setSaving(true);
    setError(undefined);
    try {
      const result = await executeStaffCommand(pendingCommand);
      if (params.id !== current.applicationId) return;
      if (result.ok) {
        setSavedRevision(result.value.result.revision);
        pendingCommand = undefined;
        setDirty(false);
        await load();
      } else {
        reject(result.error);
        if (result.error.code !== "unavailable") pendingCommand = undefined;
      }
    } catch {
      if (params.id !== current.applicationId) return;
      setError({ code: "unavailable", message: "The save result is uncertain. Retry without changing the review to reuse the same request." });
    }
    setSaving(false);
  };

  const nextReview = async () => {
    if (dirty() && !window.confirm("Discard your unsaved review changes and open another assigned proposal?")) return;
    try {
      const result = await getNextReview({ excludeApplicationId: params.id });
      if (result.ok) {
        if (result.value) navigate(`/reviewer/${encodeURIComponent(result.value.applicationId)}`);
        else setError({ code: "empty", message: "No other assigned proposal needs a review." });
      } else reject(result.error);
    } catch {
      setError({ code: "unavailable", message: "The next proposal could not load. Identity could not be verified." });
      clearPrivate();
    }
  };

  const editOldReview = () => {
    const current = proposal();
    if (current?.review.kind !== "stale") return;
    fillReviewForm(current.review.value);
    changed();
  };

  return <>
    <div class="row row-between"><a class="inline-link" href="/reviewer" onClick={(event) => { if (dirty() && !window.confirm("Discard your unsaved review changes and return to the queue?")) event.preventDefault(); }}>Back to reviewer queue</a><Show when={proposal()}><span class="cfp-status" data-state={proposal()!.review.kind}>{REVIEW_STATE_LABELS[proposal()!.review.kind]}</span></Show></div>
    <Show when={loading()}><div class="cfp-loading" role="status">Loading assigned proposal…</div></Show>
    <Show when={!proposal() && error()}>{(current) => <>
      <ErrorNotice message={current().message} onRetry={() => void load()} />
      <Show when={current().code === "unauthenticated"}><a class="button" href={`/auth/login?returnTo=${encodeURIComponent(`/reviewer/${params.id ?? ""}`)}`} rel="external">Sign in to continue</a></Show>
    </>}</Show>
      <Show when={errorCode() === "finalized"}><div class="alert" role="status">This proposal is finalized. You can no longer review it. Return to your assigned queue.</div></Show>
    <Show when={proposal()}>
      <Show when={error()}>{(current) => <ErrorNotice message={current().message} onRetry={() => errorCode() === "empty" ? void nextReview() : void load()} retryLabel={current().code === "empty" ? "Check another proposal" : "Reload proposal"} />}</Show>
      <header class="page-heading"><h1>{proposal()!.presentation.title || "Untitled proposal"}</h1><p>Edition {proposal()!.editionId} · Presentation revision {proposal()!.presentationRevision}</p></header>
      <Show when={!proposal()!.reviewOpen}><div class="alert" role="status">The review gate is closed. Saved reviews remain visible, but you cannot save a review now.</div></Show>
      <Show when={staleReview(proposal())} keyed>{(review) => <StaleReviewSection review={review} onLoad={editOldReview} />}</Show>
      <article class="surface cfp-stack" aria-label="Proposal presentation">
        <h2>Current presentation</h2>
        <ReviewerPresentationFields presentation={proposal()!.presentation} />
      </article>
      <section class="surface cfp-stack" aria-labelledby="review-form-title">
        <div class="surface-title"><div><h2 id="review-form-title">Your review</h2><p>Only your own saved review is shown. Scores range from 1 to 5.</p></div></div>
        <Show when={savedReview(proposal()!)} keyed>{(review) => <OwnReviewSummary review={review} />}</Show>
        <form class="form" onSubmit={(event) => void saveReview(event)}>
          <fieldset class="reviewer-scores" disabled={formLocked()}>
            <legend class="legend">Score each criterion</legend>
            <For each={CRITERIA}>{(criterion) => <div class="field">
              <label for={`score-${criterion}`}>{CRITERION_LABELS[criterion]} <span class="required">(1–5)</span></label>
              <select id={`score-${criterion}`} name={`score-${criterion}`} class="control select" required value={scores()[criterion] ?? ""} onChange={(event) => { setScores((previous) => { const next = { ...previous }; const value = event.currentTarget.value; if (value === "") delete next[criterion]; else next[criterion] = Number(value) as ReviewScores[typeof criterion]; return next; }); changed(); }}>
                <option value="">Select score</option>
                <For each={[1, 2, 3, 4, 5]}>{(value) => <option value={value}>{value}</option>}</For>
              </select>
            </div>}</For>
          </fieldset>
          <div class="field"><label for="review-notes">Private notes <span class="muted">(optional, up to 10,000 characters)</span></label><textarea id="review-notes" name="notes" class="control textarea" maxlength="10000" rows="7" value={notes()} onInput={(event) => { setNotes(event.currentTarget.value); changed(); }} disabled={formLocked()} aria-describedby="review-notes-limit" /><span id="review-notes-limit" class="hint">{notes().length} / 10,000</span></div>
          <label class="reviewer-ai-flag"><input type="checkbox" name="suspectedAi" class="checkbox" checked={suspectedAi()} onChange={(event) => { setSuspectedAi(event.currentTarget.checked); changed(); }} disabled={formLocked()} /> I suspect this presentation uses AI-generated content.</label>
          <div class="row"><button class="button" type="submit" disabled={formLocked()}>{saving() ? "Saving review…" : pendingCommand ? "Retry same review request" : "Save review"}</button><Show when={savedRevision()}><span role="status">Saved review revision {savedRevision()}.</span></Show><button type="button" class="button button-secondary" onClick={() => void nextReview()}>Review next proposal</button></div>
        </form>
      </section>
      <Show when={proposal()!.review.kind === "stale"}><p class="muted">Saving replaces your own stale review with a review of the current presentation. Other reviews are never shown or changed.</p></Show>
    </Show>
  </>;
}

interface StaleReviewSectionProps {
  review: StaleReview;
  onLoad: () => void;
}

function StaleReviewSection(props: StaleReviewSectionProps) {
  return <section class="surface cfp-stack" aria-labelledby="evaluated-presentation-title">
    <div class="surface-title"><div><h2 id="evaluated-presentation-title">Presentation evaluated by this review</h2><p>This review refers to an earlier presentation. The current proposal appears below.</p></div><span class="cfp-status" data-state="stale">Stale review</span></div>
    <p><strong>Title evaluated:</strong> {props.review.evaluatedPresentation.title}</p>
    <ReviewerPresentationFields presentation={props.review.evaluatedPresentation} />
    <p>Saved review revision {props.review.value.revision} · evaluated presentation revision {props.review.value.presentationRevision}</p>
    <button type="button" class="button button-secondary" onClick={props.onLoad}>Load saved scores and notes into the form</button>
  </section>;
}

interface OwnReviewSummaryProps {
  review: OwnReview;
}

function OwnReviewSummary(props: OwnReviewSummaryProps) {
  return <div class="review-own-summary">
    <h3>Saved review · revision {props.review.revision}</h3>
    <dl><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{props.review.scores[criterion]} / 5</dd></div>}</For></dl>
    <Show when={props.review.notes}><div><h4>Private notes</h4><p class="review-notes">{props.review.notes}</p></div></Show>
    <Show when={props.review.suspectedAi}><p role="status">You marked this presentation as suspected AI-generated.</p></Show>
  </div>;
}

function ReviewerPresentationFields(props: { presentation: ReviewerPresentation }) {
  return <dl class="reviewer-presentation">
    <div><dt>Abstract</dt><dd><div class="rich-html" innerHTML={props.presentation.abstract || "<p>Not provided</p>"} /></dd></div>
    <div><dt>Key takeaways</dt><dd><div class="rich-html" innerHTML={props.presentation.keyTakeaways || "<p>Not provided</p>"} /></dd></div>
    <div><dt>Technical requirements</dt><dd>{props.presentation.technicalRequirements?.trim() || <span class="muted">Not provided</span>}</dd></div>
  </dl>;
}

