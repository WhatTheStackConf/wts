import type { WtsProfile } from "./profile.js";

type PageShell = {
  registrationOpen: boolean;
  enabledProviders: readonly ("google" | "github")[];
  oauthQuery: string | null;
  notice: { kind: "error" | "success" | "info"; message: string } | null;
};

export type PageState = PageShell & (
  | { kind: "sign-in" }
  | { kind: "sign-up" }
  | { kind: "recovery" }
  | { kind: "reset-password"; token: string | null }
  | { kind: "verify-email"; email: string | null; verified: boolean }
  | { kind: "consent"; client: { name: string; redirectUri: string }; scopes: readonly string[] }
  | { kind: "account"; email: string; profile: WtsProfile }
  | { kind: "error"; title: string; message: string }
);

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function pageLink(path: string, state: PageShell): string {
  return state.oauthQuery === null ? path : `${path}?oauth_query=${encodeURIComponent(state.oauthQuery)}`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escape(value)}">`;
}

function form(action: string, endpoint: string, state: PageShell, content: string): string {
  return `<form method="post" action="${endpoint}" data-account-action="${action}">
    ${state.oauthQuery === null ? "" : hidden("oauth_query", state.oauthQuery)}
    ${content}
    <p class="form-message form-error" data-form-error role="alert" tabindex="-1" hidden></p>
    <p class="form-message form-status" data-form-status role="status" aria-live="polite" hidden></p>
  </form>`;
}

function emailField(value = ""): string {
  return `<div class="field"><label for="email">Email <span class="required">(required)</span></label>
    <input id="email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" value="${escape(value)}" required></div>`;
}

function nameField(value = ""): string {
  return `<div class="field"><label for="name">Name <span class="required">(required)</span></label>
    <input id="name" name="name" type="text" autocomplete="name" maxlength="200" value="${escape(value)}" required></div>`;
}

function passwordField(newPassword: boolean, name = "password"): string {
  const id = newPassword ? "new-password" : "current-password";
  return `<div class="field"><label for="${id}">${newPassword ? "New password" : "Password"} <span class="required">(required)</span></label>
    ${newPassword ? '<p class="field-help" id="password-help">Use at least 12 characters and no more than 72 UTF-8 bytes. Non-ASCII characters can use multiple bytes. Password-manager paste is allowed.</p>' : ""}
    <input id="${id}" name="${name}" type="password" autocomplete="${id}" ${newPassword ? 'minlength="12" maxlength="72" aria-describedby="password-help"' : ""} required>
    <button type="button" class="password-toggle" data-password-toggle="${id}" aria-controls="${id}" aria-pressed="false" hidden>Show password</button></div>`;
}

function providers(state: PageShell): string {
  if (state.enabledProviders.length === 0) return "";
  return `<section class="provider-section" aria-label="Other sign-in methods"><p>Or use a connected account</p>
    ${state.enabledProviders.map((provider) => form("social", "/api/auth/sign-in/social", state,
      `${hidden("provider", provider)}<button type="submit" class="button button-secondary">Sign in with ${provider === "google" ? "Google" : "GitHub"}</button>`)).join("")}
    <p class="field-help">Use a provider already connected to your account. Accounts do not merge by email.</p></section>`;
}

function closedRegistration(): string {
  return `<section class="registration-note" aria-labelledby="registration-title"><h2 id="registration-title">Registration is closed</h2>
    <p>New WTS identity accounts cannot be created here. If you already have a WTS identity account, sign in above or use password recovery.</p>
    <p class="field-help">Signing in identifies you. Each app controls its own access and permissions.</p></section>`;
}

function scopeDescription(scope: string): string {
  switch (scope) {
    case "openid": return "Identify you with your stable WTS user ID";
    case "email": return "Read your email address and verification status";
    case "profile": return "Read your name and avatar";
    case "wts.profile": return "Read your shared WTS profile and preferred language";
    default: return scope;
  }
}

function content(state: PageState): { title: string; html: string } {
  switch (state.kind) {
    case "sign-in":
      return { title: "Sign in", html: `<h1>Sign in</h1><p class="intro">Use your WTS identity account.</p>
        ${form("sign-in", "/api/auth/sign-in/email", state, `${emailField()}${passwordField(false)}<button class="button" type="submit">Sign in</button>`)}
        <div class="form-links"><a href="${escape(pageLink("/recovery", state))}">Forgot your password?</a><a href="${escape(pageLink("/verify-email", state))}">Verify your email</a></div>
        ${providers(state)}
        ${state.registrationOpen ? `<p class="form-links">New here? <a href="${escape(pageLink("/sign-up", state))}">Create an account</a></p>` : closedRegistration()}` };
    case "sign-up":
      return { title: "Create account", html: `<h1>Create account</h1>${state.registrationOpen ? `<p class="intro">Create your WTS identity. Verify your email before you sign in to an app.</p>
        ${form("sign-up", "/api/auth/sign-up/email", state, `${nameField()}${emailField()}${passwordField(true)}<button class="button" type="submit">Create account</button>`)}${providers(state)}` : closedRegistration()}
        <p class="form-links"><a href="${escape(pageLink("/sign-in", state))}">Return to sign in</a></p>` };
    case "recovery":
      return { title: "Recover your account", html: `<h1>Recover your account</h1><p class="intro">Enter your account email to request a password reset link.</p>
        ${form("recovery", "/api/auth/request-password-reset", state, `${emailField()}<button class="button" type="submit">Send reset link</button>`)}
        <p class="form-links"><a href="${escape(pageLink("/sign-in", state))}">Return to sign in</a></p>` };
    case "reset-password":
      return { title: "Reset your password", html: `<h1>Reset your password</h1>${state.token === null ? `<p>This reset link is missing or no longer valid. Request a new link to reset your password.</p><a class="button" href="${escape(pageLink("/recovery", state))}">Request a new reset link</a>` : `<p class="intro">Choose a new password. This resets your central account sessions.</p>
        ${form("reset-password", "/api/auth/reset-password", state, `${hidden("token", state.token)}${passwordField(true, "newPassword")}<button class="button" type="submit">Reset password</button>`)}
        <p class="form-links"><a href="${escape(pageLink("/sign-in", state))}" data-reset-sign-in hidden>Sign in with your new password</a></p>`}` };
    case "verify-email":
      return { title: state.verified ? "Email verified" : "Verify your email", html: `<h1>${state.verified ? "Email verified" : "Verify your email"}</h1>
        ${state.verified ? `<p class="intro">Your email is verified. Sign in to continue.</p><a class="button" href="${escape(pageLink("/sign-in", state))}">Continue to sign in</a>` : `<p class="intro">Open the verification link in your email. If you need a new link, enter your account email below.</p>
        ${form("verify-email", "/api/auth/send-verification-email", state, `${emailField(state.email ?? "")}<button class="button" type="submit">Resend verification email</button>`)}
        <p class="form-links"><a href="${escape(pageLink("/sign-in", state))}">Return to sign in</a></p>`}` };
    case "consent":
      return { title: "Allow app access?", html: `<h1>Allow app access?</h1><p class="intro"><strong>${escape(state.client.name)}</strong> requests access to your WTS identity.</p>
        <p>The app will receive:</p><ul class="scope-list">${state.scopes.map((scope) => `<li>${escape(scopeDescription(scope))}</li>`).join("")}</ul>
        <p class="field-help">You will return to <span class="destination">${escape(state.client.redirectUri)}</span>.</p>
        <p>Consent shares your identity information. It does not grant app permissions.</p>
        ${form("consent", "/api/auth/oauth2/consent", state, `<div class="consent-actions"><button class="button" type="submit" name="accept" value="true">Allow access</button><button class="button button-secondary" type="submit" name="accept" value="false">Deny access</button></div>`)}
        <p class="form-links"><a href="/account">Review your account</a></p>` };
    case "account":
      return { title: "Your account", html: `<h1>Your account</h1><p class="intro">Manage the profile that connected apps read.</p>
        <dl class="account-details"><div><dt>Email</dt><dd>${escape(state.email)}</dd></div><div><dt>WTS user ID</dt><dd>${escape(state.profile.wtsUserId)}</dd></div>${state.profile.username ? `<div><dt>Preserved username</dt><dd>${escape(state.profile.username)}</dd></div>` : ""}</dl>
        ${form("profile", "/v1/me", state, `${hidden("expectedRevision", String(state.profile.revision))}${nameField(state.profile.name)}
          <div class="field"><label for="avatarUrl">Avatar URL</label><p id="avatar-help" class="field-help">Use an HTTPS image URL without a username or password. Leave this field empty to remove your avatar.</p><input id="avatarUrl" name="avatarUrl" type="url" autocomplete="url" maxlength="2048" aria-describedby="avatar-help" value="${escape(state.profile.avatarUrl ?? "")}"></div>
          <div class="field"><label for="preferredLanguage">Preferred language</label><p class="field-help" id="language-help">Use a language tag with its standard case, such as en, en-US, or mk. Leave this field empty for no preference.</p><input id="preferredLanguage" name="preferredLanguage" type="text" autocomplete="off" maxlength="64" spellcheck="false" aria-describedby="language-help" value="${escape(state.profile.preferredLanguage ?? "")}"></div>
          <button class="button" type="submit">Save profile</button><button class="button button-secondary" type="button" data-profile-reload hidden>Load current profile</button>`)}
        <section class="session-section" aria-labelledby="session-title"><h2 id="session-title">Central account session</h2><p>Sign out of this account service to end your central session. Other apps can retain their local sessions.</p>
          ${form("sign-out", "/api/auth/sign-out", state, '<button class="button button-secondary" type="submit">Sign out of this account</button>')}
          <a href="${escape(pageLink("/recovery", state))}">Reset your password</a></section>` };
    case "error":
      return { title: state.title, html: `<h1>${escape(state.title)}</h1><p class="intro">${escape(state.message)}</p><p>Return to sign in to start a new account request.</p><a class="button" href="/sign-in">Return to sign in</a>` };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function renderPage(state: PageState): string {
  const page = content(state);
  const notice = state.notice === null ? "" : `<p class="page-notice notice-${state.notice.kind}" data-page-notice role="${state.notice.kind === "error" ? "alert" : "status"}">${escape(state.notice.message)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow">
    <title>${escape(page.title)} | WTS account</title><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/account.css"><script src="/assets/account.js" defer></script></head>
    <body><a class="skip-link" href="#main">Skip to content</a><header class="support-header"><div class="header-inner">
      <a class="brand" href="https://wts.sh/" aria-label="WhatTheStack home"><img src="/assets/logo.svg" width="36" height="46" alt=""><span>WhatTheStack <span class="brand-year">WTS account</span></span></a>
      <nav aria-label="Account navigation"><a href="https://wts.sh/">WTS website</a><a href="${state.kind === "account" ? "/account" : escape(pageLink("/sign-in", state))}">${state.kind === "account" ? "Your account" : "Sign in"}</a></nav>
    </div></header><main id="main" class="account-main" tabindex="-1">${notice}${page.html}
      <noscript><p class="page-notice">Enable JavaScript to complete account actions. You can still use the existing <a href="https://wts.sh/login">WTS login</a>.</p></noscript>
    </main><footer class="account-footer"><a href="https://wts.sh/">WhatTheStack</a><p>Your identity is shared. App permissions stay with each app.</p></footer></body></html>`;
}
