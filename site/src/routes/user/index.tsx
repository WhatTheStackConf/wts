import { Errored, Loading, Show, createMemo } from "solid-js";
import { AccountLoading, AccountSheet, AccountSignIn, AccountUnavailable } from "~/components/AccountSheet";
import { PublicPageShell } from "~/components/PublicPageShell";
import { getAccount } from "~/lib/account-actions";
import "~/styles/account.css";

export default function AccountPage() {
  const account = createMemo(() => getAccount());
  return (
    <PublicPageShell title="Your account" description="Access your central WTS account and current profile.">
      <Errored fallback={(_error, reset) => <AccountUnavailable onRetry={reset} />}>
        <Loading fallback={<AccountLoading label="Loading your account..." />}>
          <Show when={account()} fallback={<AccountSignIn headingId="account-heading" />}>
            {(currentAccount) => (
              <AccountSheet headingId="account-heading" title="Your account">
                <p>Signed in as {currentAccount().profile.name}.</p>
                <div class="account-actions">
                  <a class="btn btn-primary" href="/user/profile">View your profile</a>
                </div>
              </AccountSheet>
            )}
          </Show>
        </Loading>
      </Errored>
    </PublicPageShell>
  );
}
