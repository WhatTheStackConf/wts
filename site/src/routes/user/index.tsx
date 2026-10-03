import { Errored, Loading, Show, createMemo } from "solid-js";
import { PublicPageShell } from "~/components/PublicPageShell";
import { getAccount } from "~/lib/account-actions";

export default function AccountPage() {
  const account = createMemo(() => getAccount());
  return (
    <PublicPageShell title="Your account" description="Access your central WTS account and current profile.">
      <Errored fallback={(_error, reset) => (
        <section aria-labelledby="account-error-heading">
          <h1 id="account-error-heading">Your account is unavailable</h1>
          <p>The account service could not load your profile. Try again.</p>
          <button class="btn btn-primary" type="button" onClick={() => reset()}>Try again</button>
        </section>
      )}>
        <Loading fallback={<p role="status">Loading your account...</p>}>
          <Show when={account()} fallback={
            <section aria-labelledby="account-heading">
              <h1 id="account-heading">Sign in to WTS</h1>
              <p>Use your central WTS account to view your profile.</p>
              <a class="btn btn-primary" href="/auth/login?returnTo=%2Fuser%2Fprofile" rel="external">Sign in</a>
            </section>
          }>
            {(currentAccount) => (
              <section aria-labelledby="account-heading">
                <h1 id="account-heading">Your account</h1>
                <p>Signed in as {currentAccount().profile.name}.</p>
                <a class="btn btn-primary" href="/user/profile">View your profile</a>
              </section>
            )}
          </Show>
        </Loading>
      </Errored>
    </PublicPageShell>
  );
}
