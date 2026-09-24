import { For, Show } from "solid-js";
import { AdminDataPanel, AdminPageShell } from "./AdminPageShell";
import { useRequireAdmin } from "~/lib/route-guards";
import { createAsyncResource } from "~/lib/async-resource";
import type { FeedbackResults, FeedbackScore } from "~/lib/feedback-results";

function Score(props: { score: FeedbackScore }) {
  return <><strong class="tabular-nums">{props.score.mean === null ? "Not answered" : `${props.score.mean.toFixed(2)} / 5`}</strong><span class="block text-sm text-base-content/80">{props.score.count} ratings</span></>;
}
function Comments(props: { comments: string[] }) {
  return <Show when={props.comments.length} fallback={<p class="text-base-content/80">No comments yet.</p>}>
    <ul class="divide-y divide-white/10"><For each={props.comments}>{comment => <li class="py-3"><blockquote class="max-w-[70ch] whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">{comment}</blockquote></li>}</For></ul>
  </Show>;
}
export default function AdminFeedbackResults() {
  // SPA entry from a marketing document must discard already-running analytics.
  const privateDocument = !!document.querySelector('meta[name="wts-feedback-admin"]');
  if (!privateDocument) { window.location.replace(window.location.href); return <p role="status">Opening private feedback results…</p>; }
  const guard = useRequireAdmin();
  const [results, controls] = createAsyncResource(() => guard.authorized(), async (): Promise<FeedbackResults> => {
    const response = await fetch("/api/admin/feedback", { method: "POST", credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 403 ? "denied" : "unavailable");
    const body = await response.json();
    if (body.state !== "ready") throw new Error("unavailable");
    return body.results;
  });
  const refresh = () => { void controls.refetch().catch(() => undefined); };
  return <AdminPageShell layoutTitle="Feedback results" layoutDescription="Private organizer feedback results" title="Feedback results"
    subtitle="WTS 2026 · Main-day attendee survey" headerActions={<button type="button" class="btn btn-outline" disabled={!guard.authorized() || results.loading} onClick={refresh}>{results.loading ? "Refreshing…" : "Refresh results"}</button>}>
    <Show when={guard.authorized()} fallback={<p role="status">Checking admin access…</p>}>
      <p class="mb-6 max-w-[70ch] text-base-content/80">Organizer-only results. Test surveys are excluded. Comments are grouped by question, not by attendee, and reshuffled on each refresh. Review identifying details before sharing any comments.</p>
      <Show when={results.loading}><div role="status" aria-live="polite" class="py-8">Loading feedback results…</div></Show>
      <Show when={results.error}><div role="alert" class="alert alert-error mb-6"><div><p>{results.error instanceof Error && results.error.message === "denied" ? "Admin access is no longer available. Sign in with an admin account." : "Could not load complete feedback results. No partial results are shown."}</p><button type="button" class="btn btn-outline mt-3" onClick={refresh}>Try again</button></div></div></Show>
      <Show when={!results.loading && !results.error && results()}>{data => <div class="space-y-8">
        <section aria-labelledby="feedback-overview"><h2 id="feedback-overview" class="text-xl font-bold mb-3">{data().title}</h2>
          <p class="mb-4"><strong class="tabular-nums">{data().responseCount}</strong> responses · No invitation or attendee data is included.</p>
          <Show when={data().responseCount === 0}><p role="status" class="mb-4">No responses yet. Submitted answers will appear here when you refresh.</p></Show>
          <AdminDataPanel><div class="p-5"><h3 class="font-bold mb-2">Overall experience</h3><Score score={data().overall} />
            <dl class="grid grid-cols-5 gap-2 border-t border-white/10 mt-4 pt-4"><For each={data().overall.distribution}>{(count, index) => <div><dt class="text-sm text-base-content/80">{index() + 1} / 5</dt><dd class="tabular-nums font-bold mt-1">{count}</dd></div>}</For></dl>
          </div></AdminDataPanel>
        </section>
        <section aria-labelledby="feedback-categories"><h2 id="feedback-categories" class="text-xl font-bold mb-2">Around the conference</h2><p class="text-base-content/80 mb-4">Averages use only numeric answers. Skipped and “not applicable” answers do not count as ratings.</p>
          <AdminDataPanel><table class="table w-full"><caption class="sr-only">Category averages and answered counts</caption><thead><tr><th scope="col">Category</th><th scope="col">Score</th></tr></thead><tbody><For each={data().parts}>{part => <tr><th scope="row" class="whitespace-normal font-normal">{part.label}</th><td class="min-w-28"><Score score={part.score} /><span class="block text-xs text-base-content/80 mt-1">{part.notApplicable} N/A · {part.skipped} skipped</span></td></tr>}</For></tbody></table></AdminDataPanel>
        </section>
        <section aria-labelledby="feedback-more"><h2 id="feedback-more" class="text-xl font-bold mb-2">More next year</h2><p class="text-base-content/80 mb-4">People could choose up to three options.</p><AdminDataPanel><dl class="divide-y divide-white/10"><For each={data().more}>{option => <div class="flex justify-between gap-4 px-5 py-3"><dt>{option.label}</dt><dd class="tabular-nums font-bold">{option.count}</dd></div>}</For></dl></AdminDataPanel></section>
        <section aria-labelledby="feedback-comments"><h2 id="feedback-comments" class="text-xl font-bold mb-4">Conference comments</h2><div class="space-y-6"><For each={data().comments}>{group => <section><h3 class="font-bold mb-2">{group.question}</h3><Comments comments={group.comments} /></section>}</For></div></section>
        <section aria-labelledby="feedback-sessions"><h2 id="feedback-sessions" class="text-xl font-bold mb-2">Session feedback</h2><p class="text-base-content/80 mb-4 max-w-[70ch]">Optional usefulness ratings. Scores appear only after at least five ratings for a session. Comments do not count toward that threshold.</p>
          <Show when={data().sessions.length} fallback={<p>No sessions in this survey.</p>}><ul class="divide-y divide-white/10 border-t border-white/10"><For each={data().sessions}>{session => <li class="py-5"><h3 class="font-bold mb-2 [overflow-wrap:anywhere]">{session.title}</h3><Show when={session.score} fallback={<p class="text-base-content/80">Not enough ratings yet</p>}>{score => <Score score={score()} />}</Show><details class="mt-3"><summary class="cursor-pointer min-h-11 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Organizer comments ({session.comments.length})</summary><Comments comments={session.comments} /></details></li>}</For></ul></Show>
        </section>
      </div>}</Show>
    </Show>
  </AdminPageShell>;
}
