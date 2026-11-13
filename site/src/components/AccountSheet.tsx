import type { ParentProps } from "solid-js";

interface AccountSheetProps extends ParentProps {
  headingId: string;
  title: string;
  tone?: "error";
}

/** ALT 0 account column: datum row, display title, one hairline panel. */
export function AccountSheet(props: AccountSheetProps) {
  return (
    <section class="account-sheet" aria-labelledby={props.headingId}>
      <p class="account-datum">
        <span>WTS 2027 · Account</span>
        <span class="account-datum-alt" aria-hidden="true">▽ ALT 0</span>
      </p>
      <h1 id={props.headingId} class="account-title">{props.title}</h1>
      <div class="support-panel account-panel" data-tone={props.tone}>{props.children}</div>
    </section>
  );
}

export function AccountUnavailable(props: { onRetry: () => void }) {
  return (
    <AccountSheet headingId="account-error-heading" title="Your account is unavailable" tone="error">
      <p role="alert">The account service could not load your profile. Try again.</p>
      <div class="account-actions">
        <button class="btn btn-primary" type="button" onClick={() => props.onRetry()}>Try again</button>
      </div>
    </AccountSheet>
  );
}

export function AccountSignIn(props: { headingId: string }) {
  return (
    <AccountSheet headingId={props.headingId} title="Sign in to WTS">
      <p>Use your central WTS account to view your profile.</p>
      <div class="account-actions">
        <a class="btn btn-primary" href="/auth/login?returnTo=%2Fuser%2Fprofile" rel="external">Sign in</a>
      </div>
    </AccountSheet>
  );
}

export function AccountLoading(props: { label: string }) {
  return (
    <div class="account-sheet" aria-busy="true">
      <p class="account-loading">{props.label}</p>
    </div>
  );
}
