import { Show } from "solid-js";
import type { AccountSession } from "~/lib/account-model";

export function AccountProfile(props: { account: AccountSession }) {
  return (
    <section class="account-profile" aria-labelledby="profile-heading">
      <h1 id="profile-heading">Your profile</h1>
      <div class="account-identity">
        <Show when={props.account.profile.avatarUrl}>
          {(avatarUrl) => <img src={avatarUrl()} alt="" width="96" height="96" referrerpolicy="no-referrer" />}
        </Show>
        <div>
          <h2>{props.account.profile.name}</h2>
          <p>@{props.account.profile.username}</p>
        </div>
      </div>
      <dl class="account-details">
        <div><dt>WTS user ID</dt><dd>{props.account.wtsUserId}</dd></div>
        <div><dt>Preferred language</dt><dd>{props.account.profile.preferredLanguage || "Not set"}</dd></div>
        <div><dt>Email visibility</dt><dd>{props.account.profile.emailVisibility ? "Visible" : "Private"}</dd></div>
        <div><dt>Edition access</dt><dd>{props.account.isAdmin ? `Administrator for ${props.account.editionId}` : "No edition-local admin access"}</dd></div>
      </dl>
      <p>This profile comes from your central WTS account. Edit your profile on the central account page.</p>
      <div class="account-actions">
        <a class="btn btn-primary" href={props.account.accountUrl}>Edit central profile</a>
        <form action="/auth/logout" method="post">
          <button class="btn btn-outline" type="submit">Sign out of this site</button>
        </form>
      </div>
    </section>
  );
}
