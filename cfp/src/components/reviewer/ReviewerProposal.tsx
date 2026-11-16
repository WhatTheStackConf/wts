import { createEffect, createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { executeStaffCommand, getNextReview, getReviewerProposal } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_HINTS, CRITERION_LABELS } from "~/lib/staff-model";
import type { OwnReview, ReviewScores, ReviewerPresentation, ReviewerProposal, ReviewerReviewState } from "~/lib/staff-model";
import { ErrorNotice } from "~/components/ApplicantUI";
import { REVIEW_STATE_LABELS } from "./review-state";

const ACCESS_DENIAL_CODES: Record<string, true> = { unauthenticated: true, forbidden: true, not_found: true, finalized: true };
function denied(error: { code: string; message: string }): boolean {
  return ACCESS_DENIAL_CODES[error.code] === true || error.code === "unavailable" && error.message.includes("identity service could not verify");
}

const SCORE_ANCHORS: Record<number, string> = { 1: "Weak", 3: "Solid", 5: "Exceptional" };

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
  /* After a saved review, "Save and next" opens the next proposal. It reloads this one when none is left. */
  const afterSave = async (applicationId: string, revision: number, thenNext: boolean) => {
    setSavedRevision(revision);
    pendingCommand = undefined;
    setDirty(false);
    setSaving(false);
    if (thenNext) await nextReview();
    if (params.id === applicationId) await load();
  };
  const saveReview = async (event: SubmitEvent) => {
    event.preventDefault();
    const thenNext = (event.submitter as HTMLButtonElement | null)?.value === "next";
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
        await afterSave(current.applicationId, result.value.result.revision, thenNext);
        return;
      }
      reject(result.error);
      if (result.error.code !== "unavailable") pendingCommand = undefined;
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
      <header class="page-heading"><h1>{proposal()!.presentation.title || "Untitled proposal"}</h1><p>Assigned to you. The speaker's name stays hidden while you review.</p></header>
      <Show when={!proposal()!.reviewOpen}><div class="alert" role="status">The review gate is closed. Saved reviews remain visible, but you cannot save a review now.</div></Show>
      <Show when={staleReview(proposal())} keyed>{(review) => <StaleReviewSection review={review} onLoad={editOldReview} />}</Show>
      <div class="review-layout">
      <article class="surface cfp-stack" aria-label="Proposal presentation">
        <h2>The proposal</h2>
        <ReviewerPresentationFields presentation={proposal()!.presentation} />
      </article>
      <section class="surface cfp-stack review-panel" aria-labelledby="review-form-title">
        <div class="surface-title"><div><h2 id="review-form-title">Your review</h2><p>Score each criterion from 1 to 5. Other reviewers do not see your review.</p></div></div>
        <Show when={savedReview(proposal()!)} keyed>{(review) => <OwnReviewSummary review={review} />}</Show>
        <form class="form" onSubmit={(event) => void saveReview(event)}>
          <fieldset class="reviewer-scores" disabled={formLocked()}>
            <legend class="sr-only">Score each criterion</legend>
            <For each={CRITERIA}>{(criterion) => <fieldset class="score-row">
              <legend><span class="score-name">{CRITERION_LABELS[criterion]}</span><span class="score-hint">{CRITERION_HINTS[criterion]}</span></legend>
              <div class="score-scale">
                <For each={[1, 2, 3, 4, 5] as const}>{(value) => <label class="score-option" for={`score-${criterion}-${value}`}>
                  <input type="radio" id={`score-${criterion}-${value}`} name={`score-${criterion}`} value={value} required={value === 1} checked={scores()[criterion] === value} onChange={() => { setScores((previous) => ({ ...previous, [criterion]: value })); changed(); }} />
                  <span class="score-value">{value}</span>
                  <Show when={SCORE_ANCHORS[value]}><span class="score-anchor">{SCORE_ANCHORS[value]}</span></Show>
                </label>}</For>
              </div>
            </fieldset>}</For>
          </fieldset>
          <div class="field"><label for="review-notes">Private notes <span class="muted">(optional, up to 10,000 characters)</span></label><textarea id="review-notes" name="notes" class="control textarea" maxlength="10000" rows="7" value={notes()} onInput={(event) => { setNotes(event.currentTarget.value); changed(); }} disabled={formLocked()} aria-describedby="review-notes-limit" /><span id="review-notes-limit" class="hint">{notes().length} / 10,000</span></div>
          <label class="reviewer-ai-flag"><input type="checkbox" name="suspectedAi" class="checkbox" checked={suspectedAi()} onChange={(event) => { setSuspectedAi(event.currentTarget.checked); changed(); }} disabled={formLocked()} aria-describedby="ai-flag-help" /> I suspect this presentation uses AI-generated content.</label>
          <p class="hint" id="ai-flag-help">Use this only when the proposal reads as fully machine-written.</p>
          <div class="review-actions">
            <button class="button" type="submit" value="next" disabled={formLocked()}>{saving() ? "Saving…" : "Save and next"}</button>
            <button class="button button-secondary" type="submit" value="stay" disabled={formLocked()}>{pendingCommand ? "Retry same review request" : "Save review"}</button>
            <button type="button" class="button button-quiet" onClick={() => void nextReview()}>Skip to next proposal</button>
          </div>
          <Show when={savedRevision()}><p class="review-saved" role="status">Review saved.</p></Show>
        </form>
        <Show when={proposal()!.review.kind === "stale"}><p class="muted">Saving replaces your earlier review with a review of the current version.</p></Show>
      </section>
      </div>
    </Show>
  </>;
}

interface StaleReviewSectionProps {
  review: StaleReview;
  onLoad: () => void;
}

function StaleReviewSection(props: StaleReviewSectionProps) {
  return <section class="surface cfp-stack" aria-labelledby="evaluated-presentation-title">
    <div class="surface-title"><div><h2 id="evaluated-presentation-title">Presentation evaluated by this review</h2><p>The speaker changed the proposal after your review. This is the version you reviewed. The current version appears below.</p></div><span class="cfp-status" data-state="stale">Changed since your review</span></div>
    <p><strong>Title evaluated:</strong> {props.review.evaluatedPresentation.title}</p>
    <ReviewerPresentationFields presentation={props.review.evaluatedPresentation} />
    <button type="button" class="button button-secondary" onClick={props.onLoad}>Load saved scores and notes into the form</button>
  </section>;
}

interface OwnReviewSummaryProps {
  review: OwnReview;
}

function OwnReviewSummary(props: OwnReviewSummaryProps) {
  return <div class="review-own-summary">
    <h3>Your saved review</h3>
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

