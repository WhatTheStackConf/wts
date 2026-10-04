import { createEffect, createSignal, Show, type ParentProps } from "solid-js";
import { useLocation } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { getNavigation } from "~/lib/staff-actions";
import { Router } from "~/router";
import type { VerifiedCfpAccount } from "~/lib/account-model";
import type { StaffAccess } from "~/lib/staff-model";
import "~/styles/app.css";

const PAGE_TITLES: Record<string, string> = {
  "/": "Call for Papers",
  "/applications": "Your applications",
  "/apply": "Application draft",
  "/profile": "Speaker profile",
  "/settings": "Applicant settings",
  "/reviewer": "Reviewer queue",
  "/admin": "CFP administration",
  "/admin/staff": "Staff and gates",
};

function ApplicantShell(props: ParentProps) {
  const location = useLocation();
  const [account, setAccount] = createSignal<VerifiedCfpAccount | null>();
  const [staffAccess, setStaffAccess] = createSignal<StaffAccess | null>(null);
  const [identityState, setIdentityState] = createSignal<"checking" | "anonymous" | "verified" | "unavailable">("checking");
  createEffect(() => location.pathname, (pathname) => {
    let active = true;
    setAccount(null);
    setStaffAccess(null);
    setIdentityState("checking");
    void getNavigation().then((result) => {
      if (!active || location.pathname !== pathname) return;
      setAccount(result?.account ?? null);
      setStaffAccess(result?.access ?? null);
      setIdentityState(result ? "verified" : "anonymous");
    }).catch(() => {
      if (!active) return;
      setAccount(null);
      setStaffAccess(null);
      setIdentityState("unavailable");
    });
    return () => { active = false; };
  });
  return <div class="cfp-app">
    <Title>{PAGE_TITLES[location.pathname] ?? PAGE_TITLES[`/${location.pathname.split("/")[1]}`] ?? "Page not found"} | WTS CFP</Title>
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="WhatTheStack Call for Papers home">
        <img src="/logo.svg" alt="" width="42" height="42" />
        <span><strong>WhatTheStack</strong><small>Call for Papers</small></span>
      </a>
      <nav class="primary-nav" aria-label="Main navigation">
        <a href="/applications" aria-current={location.pathname.startsWith("/applications") || location.pathname.startsWith("/apply/") ? "page" : undefined}>Applications</a>
        <Show when={account()}><a href="/profile" aria-current={location.pathname === "/profile" ? "page" : undefined}>Profile</a><a href="/settings" aria-current={location.pathname === "/settings" ? "page" : undefined}>Settings</a></Show>
        <Show when={staffAccess()?.roles.includes("reviewer")}><a href="/reviewer" aria-current={location.pathname.startsWith("/reviewer") ? "page" : undefined}>Review</a></Show>
        <Show when={staffAccess()?.roles.includes("admin")}><a href="/admin" aria-current={location.pathname.startsWith("/admin") ? "page" : undefined}>Admin</a></Show>
      </nav>
      <Show when={account()} fallback={
        <Show when={identityState() === "anonymous" || identityState() === "unavailable"} fallback={<span class="cfp-status" role="status">Checking identity…</span>}>
          <a class="button button-small" href={`/auth/login?returnTo=${encodeURIComponent(location.pathname === "/" ? "/applications" : location.pathname)}`} rel="external">{identityState() === "unavailable" ? "Try sign in" : "Sign in"}</a>
        </Show>
      }>
        <div class="account-menu"><span class="account-email">{account()?.email}</span><form method="post" action="/auth/logout"><button class="button button-quiet button-small" type="submit">Sign out</button></form></div>
      </Show>
    </header>
    <main id="main" class="page-main">{props.children}</main>
    <footer class="site-footer">
      <span>WhatTheStack · Call for Papers</span>
      <Show when={account()}><span class="account-id">Your WTS user ID <code>{account()?.wtsUserId}</code></span></Show>
      <a href="https://wts.sh" rel="external">Conference site</a>
    </footer>
  </div>;
}

export default function App() {
  return <Router>{(routeProps) => <ApplicantShell>{routeProps.children}</ApplicantShell>}</Router>;
}
