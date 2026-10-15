import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { executeStaffCommand, getNextReview, getReviewerWorkspace } from "~/lib/staff-actions";
import { CRITERIA, CRITERION_LABELS } from "~/lib/staff-model";
import type { CriterionWeights, ReviewerWorkspace as ReviewerWorkspaceModel } from "~/lib/staff-model";
import { ErrorNotice } from "~/components/ApplicantUI";
import { REVIEW_STATE_LABELS } from "./review-state";

const ACCESS_DENIAL_CODES: Record<string, true> = { unauthenticated: true, forbidden: true, not_found: true };
function denied(error: { code: string; message: string }): boolean {
  return ACCESS_DENIAL_CODES[error.code] === true || error.code === "unavailable" && error.message.includes("identity service could not verify");
}
function hasAllWeights(weights: Partial<CriterionWeights>): weights is CriterionWeights {
  return CRITERIA.every((criterion) => weights[criterion] !== undefined);
}

type WeightVote = { requestId: string; expectedRevision: 0 | number; weights: CriterionWeights };

function weightVote(workspace: ReviewerWorkspaceModel, weights: CriterionWeights): WeightVote {
  return {
    requestId: crypto.randomUUID(),
    expectedRevision: workspace.ownWeightVote?.revision ?? 0,
    weights: {
      relevance: weights.relevance,
      originality: weights.originality,
      depth: weights.depth,
      clarity: weights.clarity,
      takeaways: weights.takeaways,
      engagement: weights.engagement,
    },
  };
}


export default function ReviewerWorkspace() {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = createSignal<ReviewerWorkspaceModel>();
  const [error, setError] = createSignal<{ code: string; message: string }>();
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [weightsDirty, setWeightsDirty] = createSignal(false);
  const [weights, setWeights] = createSignal<Partial<CriterionWeights>>({});
  const [savedVote, setSavedVote] = createSignal<number>();
  let pendingVote: WeightVote | undefined;

  const clearPrivate = () => {
    setWorkspace(undefined);
    setWeights({});
    setWeightsDirty(false);
    pendingVote = undefined;
  };
  const reject = (failure: { code: string; message: string }) => {
    setError(failure);
    if (denied(failure)) clearPrivate();
  };

  const load = async () => {
    setLoading(true);
    try {
      const result = await getReviewerWorkspace();
      if (result.ok) {
        setWorkspace(result.value);
        setError(undefined);
        const vote = result.value.ownWeightVote;
        if (!weightsDirty()) setWeights(vote ? { ...vote.weights } : {});
      } else reject(result.error);
    } catch {
      setError({ code: "unavailable", message: "The reviewer workspace is unavailable. Identity could not be verified." });
      clearPrivate();
    }
    setLoading(false);
  };

  onSettled(() => { void load(); });

  const reviewNext = async () => {
    if (weightsDirty() && !window.confirm("Discard your unsaved weight changes and open a proposal?")) return;
    setError(undefined);
    try {
      const result = await getNextReview();
      if (result.ok) {
        if (result.value) navigate(`/reviewer/${encodeURIComponent(result.value.applicationId)}`);
        else setError({ code: "empty", message: "No assigned proposals need a review now." });
      } else reject(result.error);
    } catch {
      setError({ code: "unavailable", message: "The next assigned proposal could not load. Identity could not be verified." });
      clearPrivate();
    }
  };

  const saveWeights = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = workspace();
    if (!current || saving()) return;
    const currentWeights = weights();
    if (!hasAllWeights(currentWeights)) return;
    pendingVote ??= weightVote(current, currentWeights);
    setSaving(true);
    setError(undefined);
    try {
      const result = await executeStaffCommand({ kind: "save-weight-vote", ...pendingVote });
      if (result.ok) {
        setSavedVote(result.value.result.revision);
        pendingVote = undefined;
        setWeightsDirty(false);
        await load();
      } else {
        reject(result.error);
        if (result.error.code !== "unavailable") pendingVote = undefined;
      }
    } catch {
      setError({ code: "unavailable", message: "The weight vote result is uncertain. Retry without changing these weights." });
    }
    setSaving(false);
  };

  const updateWeight = (criterion: (typeof CRITERIA)[number], value: string) => {
    setWeights((previous) => {
      const next = { ...previous };
      if (value === "") delete next[criterion];
      else next[criterion] = Number(value) as CriterionWeights[typeof criterion];
      return next;
    });
    pendingVote = undefined;
    setWeightsDirty(true);
  };

  return <>
    <header class="page-heading">
      <h1>Reviewer queue</h1>
      <p><Show when={workspace()?.editionId}>{(edition) => <>Edition {edition()}. </>}</Show>Review only proposals assigned to you.</p>
    </header>
    <Switch>
      <Match when={loading()}><div class="cfp-loading" role="status">Loading your assigned proposals…</div></Match>
      <Match when={!workspace() && error()}>{(current) => <>
        <Show when={current().code !== "unauthenticated"} fallback={<ErrorNotice message={current().message} />}>
          <ErrorNotice message={current().message} onRetry={() => void load()} />
        </Show>
        <Show when={current().code === "unauthenticated"}><a class="button" href={`/auth/login?returnTo=${encodeURIComponent("/reviewer")}`} rel="external">Sign in to continue</a></Show>
      </>}</Match>
      <Match when={workspace()}>
        <Show when={error()}>{(current) => <ErrorNotice message={current().message} onRetry={() => error()?.code === "empty" ? void reviewNext() : void load()} retryLabel={current().code === "empty" ? "Check again" : "Reload queue"} />}</Show>
        <section class="surface cfp-stack" aria-labelledby="review-progress-title">
          <div class="surface-title"><div><h2 id="review-progress-title">Review progress</h2><p>Activity counts do not identify reviewers or proposals.</p></div><span class="cfp-status" data-state={workspace()!.reviewOpen ? "active" : "closed"}>{workspace()!.reviewOpen ? "Review gate open" : "Review gate closed"}</span></div>
          <dl class="reviewer-counts">
            <div><dt>Unreviewed</dt><dd>{workspace()!.counts.unreviewed}</dd></div>
            <div><dt>Current</dt><dd>{workspace()!.counts.current}</dd></div>
            <div><dt>Stale</dt><dd>{workspace()!.counts.stale}</dd></div>
          </dl>
          <div class="row">
            <button class="button" type="button" onClick={() => void reviewNext()}>Review next</button>
            <Show when={!workspace()!.reviewOpen}><span class="muted">The review gate is closed. You can read assignments but cannot save reviews or weights.</span></Show>
          </div>
        </section>
        <section class="surface cfp-stack" aria-labelledby="assigned-proposals-title">
          <div class="surface-title"><div><h2 id="assigned-proposals-title">Assigned proposals</h2><p>Pending proposals assigned to your reviewer account.</p></div></div>
          <Show when={workspace()!.queue.length > 0} fallback={<p class="empty-state">You have no assigned pending proposals.</p>}>
            <ul class="cfp-list"><For each={workspace()!.queue}>{(item) => <li class="list-item">
              <div><h3>{item.title || "Untitled proposal"}</h3><p><span class="cfp-status" data-state={item.reviewState}>{REVIEW_STATE_LABELS[item.reviewState]}</span> · Presentation revision {item.presentationRevision}</p></div>
              <a class="button button-secondary button-small" href={`/reviewer/${encodeURIComponent(item.applicationId)}`} onClick={(event) => { if (weightsDirty() && !window.confirm("Discard your unsaved weight changes and open this proposal?")) event.preventDefault(); }}>Open proposal review</a>
            </li>}</For></ul>
          </Show>
        </section>
        <section class="surface cfp-stack" aria-labelledby="reviewer-activity-title">
          <div class="surface-title"><div><h2 id="reviewer-activity-title">Committee activity</h2><p>Anonymous edition totals only.</p></div></div>
          <Show when={workspace()!.activity.length > 0} fallback={<p class="empty-state">No reviews have been saved yet.</p>}>
            <ul class="reviewer-activity"><For each={workspace()!.activity}>{(activity) => <li><span>{activity.label}</span><span>{activity.reviewCount} {activity.reviewCount === 1 ? "review" : "reviews"}</span></li>}</For></ul>
          </Show>
        </section>
        <section class="surface cfp-stack" aria-labelledby="review-weights-title">
          <div class="surface-title"><div><h2 id="review-weights-title">Your criterion weights</h2><p>Set how much each criterion matters in your own ranking vote. Choose 1–6.</p></div></div>
          <form class="form" onSubmit={(event) => void saveWeights(event)}>
            <fieldset class="reviewer-weights"><legend class="legend">Criterion weights</legend>
              <For each={CRITERIA}>{(criterion) => <div class="field"><label for={`weight-${criterion}`}>{CRITERION_LABELS[criterion]} <span class="required">(1–6)</span></label>
                <select id={`weight-${criterion}`} name={`weight-${criterion}`} class="control select" required value={weights()[criterion] ?? ""} disabled={!workspace()!.reviewOpen || saving()} onChange={(event) => updateWeight(criterion, event.currentTarget.value)}>
                  <option value="">Select weight</option>
                  <For each={[1, 2, 3, 4, 5, 6]}>{(value) => <option value={value}>{value}</option>}</For>
                </select>
              </div>}</For>
            </fieldset>
            <div class="row"><button type="submit" class="button" disabled={!workspace()!.reviewOpen || saving()}>{saving() ? "Saving weights…" : pendingVote ? "Retry same weight request" : "Save my weights"}</button><Show when={savedVote()}><span role="status">Saved weight vote revision {savedVote()}.</span></Show></div>
          </form>
        </section>
      </Match>
    </Switch>
  </>;
}
