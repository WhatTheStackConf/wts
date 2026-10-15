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

type IdentityState = "checking" | "anonymous" | "verified" | "unavailable";

const pageTitle = (pathname: string) => PAGE_TITLES[pathname] ?? PAGE_TITLES[`/${pathname.split("/")[1]}`] ?? "Page not found";
const ariaCurrent = (current: boolean) => current ? "page" : undefined;

interface HeaderIdentityProps {
  account: VerifiedCfpAccount | null | undefined;
  identityState: IdentityState;
  pathname: string;
}

function HeaderIdentity(props: HeaderIdentityProps) {
  return <Show when={props.account} fallback={
    <Show when={props.identityState === "anonymous" || props.identityState === "unavailable"} fallback={<span class="cfp-status header-status" role="status">Checking identity…</span>}>
      <a class="button button-small header-auth" href={`/auth/login?returnTo=${encodeURIComponent(props.pathname === "/" ? "/applications" : props.pathname)}`} rel="external">{props.identityState === "unavailable" ? "Try sign in" : "Sign in"}</a>
    </Show>
  }>
    <div class="account-menu"><span class="account-email">{props.account?.email}</span><form method="post" action="/auth/logout"><button class="button button-quiet button-small" type="submit">Sign out</button></form></div>
  </Show>;
}

function ApplicantShell(props: ParentProps) {
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const [account, setAccount] = createSignal<VerifiedCfpAccount | null>();
  const [staffAccess, setStaffAccess] = createSignal<StaffAccess | null>(null);
  const [identityState, setIdentityState] = createSignal<IdentityState>("checking");
  createEffect(() => location.pathname, (pathname) => {
    let active = true;
    setNavigationOpen(false);
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
    <Title>{pageTitle(location.pathname)} | WTS CFP</Title>
    <a class="skip-link" href="#main">Skip to main content</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="WhatTheStack Call for Papers home" aria-current={ariaCurrent(location.pathname === "/")}>
        <img src="/logo.svg" alt="" width="42" height="42" />
        <span><strong>WhatTheStack</strong><small>Call for Papers</small></span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded={navigationOpen() ? "true" : "false"} aria-controls="primary-nav" onClick={() => setNavigationOpen((open) => !open)}>
        <span>{navigationOpen() ? "Close menu" : "Menu"}</span>
        <span class="nav-toggle-mark" aria-hidden="true">{navigationOpen() ? "−" : "+"}</span>
      </button>
      <nav id="primary-nav" class="primary-nav" data-open={navigationOpen() ? "true" : undefined} aria-label="Main navigation">
        <a href="/applications" aria-current={ariaCurrent(location.pathname.startsWith("/applications") || location.pathname.startsWith("/apply/"))}>Applications</a>
        <Show when={account()}><a href="/profile" aria-current={ariaCurrent(location.pathname === "/profile")}>Profile</a><a href="/settings" aria-current={ariaCurrent(location.pathname === "/settings")}>Settings</a></Show>
        <Show when={staffAccess()?.roles.includes("reviewer")}><a href="/reviewer" aria-current={ariaCurrent(location.pathname.startsWith("/reviewer"))}>Review</a></Show>
        <Show when={staffAccess()?.roles.includes("admin")}><a href="/admin" aria-current={ariaCurrent(location.pathname.startsWith("/admin"))}>Admin</a></Show>
      </nav>
      <HeaderIdentity account={account()} identityState={identityState()} pathname={location.pathname} />
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
