import { createSignal, For, onSettled, Show } from "solid-js";
import { getAccount, getCfpStatus } from "~/lib/cfp-actions";
import type { VerifiedCfpAccount } from "~/lib/account-model";
import { PageBand } from "~/components/PageBand";
import { CRITERIA, CRITERION_HINTS, CRITERION_LABELS } from "~/lib/staff-model";

export default function Home() {
  const [account, setAccount] = createSignal<VerifiedCfpAccount | null>();
  const [identityUnavailable, setIdentityUnavailable] = createSignal(false);
  const [status, setStatus] = createSignal<{ editionId: string; cfpOpen: boolean }>();
  const [statusUnavailable, setStatusUnavailable] = createSignal(false);
  onSettled(() => {
    void getAccount().then(setAccount).catch(() => { setAccount(null); setIdentityUnavailable(true); });
    void getCfpStatus().then(setStatus).catch(() => setStatusUnavailable(true));
  });
  return <>
    <PageBand overlap title="Call for Papers" lede="Submit a talk proposal." />
    <section class="surface cfp-home-status" aria-labelledby="status-heading">
      <div class="cfp-home-state">
        <h2 id="status-heading" class="panel-label">Submission status</h2>
        <Show when={status()} fallback={<span class="cfp-status cfp-home-chip" data-state="neutral" role="status" aria-live="polite">{statusUnavailable() ? "Status unavailable" : "Checking status"}</span>}>
          <span class="cfp-status cfp-home-chip" role="status" aria-live="polite" data-state={status()?.cfpOpen ? "active" : "closed"}>{status()?.cfpOpen ? "Submissions open" : "Submissions closed"}</span>
        </Show>
        <Show when={!account()}><p class="muted">Sign in to start a proposal or check one you sent.</p></Show>
      </div>
      <div class="cfp-home-next">
        <Show when={account()} fallback={<a class="button cfp-home-action" href="/auth/login?returnTo=%2Fapplications" rel="external">Sign in to continue</a>}>
          <a class="button cfp-home-action" href="/applications">Your proposals</a><a class="button button-secondary cfp-home-action" href="/profile">Speaker profile</a>
        </Show>
      </div>
      <Show when={identityUnavailable()}><div class="alert cfp-home-notice" role="status">The identity service could not verify your account. You can try again later.</div></Show>
      <Show when={statusUnavailable()}><p class="muted cfp-home-notice">We cannot check the submission status now. Your proposals stay available after you sign in.</p></Show>
    </section>
    <section class="surface cfp-stack cfp-brief" aria-labelledby="brief-heading">
      <div class="surface-title"><div><h2 id="brief-heading">How we pick talks</h2><p>Reviewers score each proposal from 1 to 5 on six criteria. They do not see your name.</p></div></div>
      <dl class="criteria-list"><For each={CRITERIA}>{(criterion) => <div><dt>{CRITERION_LABELS[criterion]}</dt><dd>{CRITERION_HINTS[criterion]}</dd></div>}</For></dl>
      <p class="muted">Dates, talk formats and lengths for 2027 follow. <a class="inline-link" href="https://blog.wts.sh/posts/inside-the-cfp" rel="external">Read how the CFP works</a></p>
    </section>
  </>;
}
