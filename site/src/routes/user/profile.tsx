import { Errored, Loading, Show, createMemo } from "solid-js";
import { AccountProfile } from "~/components/AccountProfile";
import { AccountLoading, AccountSignIn, AccountUnavailable } from "~/components/AccountSheet";
import { PublicPageShell } from "~/components/PublicPageShell";
import { getAccount } from "~/lib/account-actions";
import "~/styles/account.css";

export default function ProfilePage() {
  const account = createMemo(() => getAccount());
  return (
    <PublicPageShell title="Your profile" description="View your current central WTS profile and open its central editor.">
      <Errored fallback={(_error, reset) => <AccountUnavailable onRetry={reset} />}>
        <Loading fallback={<AccountLoading label="Loading your profile..." />}>
          <Show when={account()} fallback={<AccountSignIn headingId="sign-in-heading" />}>
            {(currentAccount) => <AccountProfile account={currentAccount()} />}
          </Show>
        </Loading>
      </Errored>
    </PublicPageShell>
  );
}
