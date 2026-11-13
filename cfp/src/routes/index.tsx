import { createSignal, onSettled, Show } from "solid-js";
import { getAccount, getCfpStatus } from "~/lib/cfp-actions";
import type { VerifiedCfpAccount } from "~/lib/account-model";
import { PageBand } from "~/components/PageBand";

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
    <PageBand overlap title="Call for Papers" lede="Submit a software-development talk proposal. Your speaker profile and applicant settings stay available across your applications." />
    <section class="surface cfp-home-status" aria-labelledby="status-heading">
      <div class="cfp-home-state">
        <h2 id="status-heading" class="panel-label">Submission status</h2>
        <Show when={status()} fallback={<span class="cfp-status cfp-home-chip" data-state="neutral" role="status" aria-live="polite">{statusUnavailable() ? "Status unavailable" : "Checking status"}</span>}>
          <span class="cfp-status cfp-home-chip" role="status" aria-live="polite" data-state={status()?.cfpOpen ? "active" : "closed"}>{status()?.cfpOpen ? "Submissions open" : "Submissions closed"}</span>
        </Show>
        <p class="muted">Sign in to manage drafts and submitted applications.</p>
      </div>
      <div class="cfp-home-next">
        <Show when={account()} fallback={<a class="button cfp-home-action" href="/auth/login?returnTo=%2Fapplications" rel="external">Sign in to continue</a>}>
          <a class="button cfp-home-action" href="/applications">Open applicant dashboard</a><a class="button button-secondary cfp-home-action" href="/profile">Review speaker profile</a>
        </Show>
      </div>
      <Show when={identityUnavailable()}><div class="alert cfp-home-notice" role="status">The identity service could not verify your account. You can try again later.</div></Show>
      <Show when={statusUnavailable()}><p class="muted cfp-home-notice">The CFP status service is unavailable. Existing applications remain available after sign-in.</p></Show>
    </section>
  </>;
}
