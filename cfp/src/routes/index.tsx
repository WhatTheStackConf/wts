import { createSignal, onSettled, Show } from "solid-js";
import { getAccount, getCfpStatus } from "~/lib/cfp-actions";
import type { VerifiedCfpAccount } from "~/lib/account-model";

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
    <section class="page-heading">
      <h1>Call for Papers</h1>
      <p class="lede">Submit a software-development talk proposal. Your speaker profile and applicant settings stay available across your applications.</p>
    </section>
    <section class="surface cfp-stack" aria-labelledby="status-heading">
      <div class="surface-title"><div><h2 id="status-heading">Applicant access</h2><p>Sign in to manage your CFP drafts and applications.</p></div>
        <Show when={status()} fallback={<span class="cfp-status" data-state="active">{statusUnavailable() ? "Status unavailable" : "Checking status"}</span>}>
          <span class="cfp-status" data-state={status()?.cfpOpen ? "active" : "closed"}>{status()?.cfpOpen ? "Submissions open" : "Submissions closed"}</span>
        </Show>
      </div>
      <Show when={identityUnavailable()}><div class="alert" role="status">The identity service could not verify your account. You can try again later.</div></Show>
      <Show when={account()} fallback={<a class="button" href="/auth/login?returnTo=%2Fapplications" rel="external">Sign in to continue</a>}>
        <div class="row"><a class="button" href="/applications">Open applicant dashboard</a><a class="button button-secondary" href="/profile">Review speaker profile</a></div>
      </Show>
      <Show when={statusUnavailable()}><p class="muted">The CFP status service is unavailable. Existing applications remain available after sign-in.</p></Show>
    </section>
  </>;
}
