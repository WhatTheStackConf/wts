import { Errored, Loading, Show, createMemo } from "solid-js";
import { AccountProfile } from "~/components/AccountProfile";
import { PublicPageShell } from "~/components/PublicPageShell";
import { getAccount } from "~/lib/account-actions";
import "~/styles/account.css";

export default function ProfilePage() {
  const account = createMemo(() => getAccount());
  return (
    <PublicPageShell title="Your profile" description="View your current central WTS profile and open its central editor.">
      <Errored fallback={(_error, reset) => (
        <section class="account-profile" aria-labelledby="account-error-heading">
          <h1 id="account-error-heading">Your account is unavailable</h1>
          <p>The account service could not load your profile. Try again.</p>
          <button class="btn btn-primary" type="button" onClick={() => reset()}>Try again</button>
        </section>
      )}>
        <Loading fallback={<p role="status">Loading your profile...</p>}>
          <Show when={account()} fallback={
            <section class="account-profile" aria-labelledby="sign-in-heading">
              <h1 id="sign-in-heading">Sign in to WTS</h1>
              <p>Use your central WTS account to view your profile.</p>
              <a class="btn btn-primary" href="/auth/login?returnTo=%2Fuser%2Fprofile" rel="external">Sign in</a>
            </section>
          }>
            {(currentAccount) => <AccountProfile account={currentAccount()} />}
          </Show>
        </Loading>
      </Errored>
    </PublicPageShell>
  );
}
