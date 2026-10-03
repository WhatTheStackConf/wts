import { createSignal, onSettled, Show, type ParentProps } from "solid-js";
import { useLocation } from "@solidjs/router";
import { getAccount } from "~/lib/cfp-actions";
import { Router } from "~/router";
import type { VerifiedCfpAccount } from "~/lib/account-model";
import "~/styles/app.css";

function ApplicantShell(props: ParentProps) {
  const location = useLocation();
  const [account, setAccount] = createSignal<VerifiedCfpAccount | null>();
  const [identityState, setIdentityState] = createSignal<"checking" | "anonymous" | "verified" | "unavailable">("checking");
  onSettled(() => {
    let active = true;
    void getAccount().then((result) => {
      if (!active) return;
      setAccount(result);
      setIdentityState(result ? "verified" : "anonymous");
    }).catch(() => {
      if (!active) return;
      setAccount(null);
      setIdentityState("unavailable");
    });
    return () => { active = false; };
  });
  return <div class="cfp-app">
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="WhatTheStack Call for Papers home">
        <img src="/logo.svg" alt="" width="42" height="42" />
        <span><strong>WhatTheStack</strong><small>Call for Papers</small></span>
      </a>
      <nav class="primary-nav" aria-label="Main navigation">
        <a href="/applications" aria-current={location.pathname.startsWith("/applications") || location.pathname.startsWith("/apply/") ? "page" : undefined}>Applications</a>
        <Show when={account()}><a href="/profile" aria-current={location.pathname === "/profile" ? "page" : undefined}>Profile</a><a href="/settings" aria-current={location.pathname === "/settings" ? "page" : undefined}>Settings</a></Show>
      </nav>
      <Show when={account()} fallback={
        <Show when={identityState() === "anonymous" || identityState() === "unavailable"} fallback={<span class="cfp-status" role="status">Checking identity…</span>}>
          <a class="button button-small" href="/auth/login?returnTo=%2Fapplications" rel="external">{identityState() === "unavailable" ? "Try sign in" : "Sign in"}</a>
        </Show>
      }>
        <div class="account-menu"><span class="account-email">{account()?.email}</span><form method="post" action="/auth/logout"><button class="button button-quiet button-small" type="submit">Sign out</button></form></div>
      </Show>
    </header>
    <main id="main" class="page-main">{props.children}</main>
    <footer class="site-footer"><span>WhatTheStack · Call for Papers</span><a href="https://wts.sh" rel="external">Conference site</a></footer>
  </div>;
}

export default function App() {
  return <Router>{(routeProps) => <ApplicantShell>{routeProps.children}</ApplicantShell>}</Router>;
}
