import { createEffect, createSignal, onSettled, Show, type ParentProps } from "solid-js";
import { useLocation } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { getNavigation } from "~/lib/staff-actions";
import { Router } from "~/router";
import { watchFieldErrors } from "~/lib/field-errors";
import type { VerifiedCfpAccount } from "~/lib/account-model";
import type { StaffAccess } from "~/lib/staff-model";
import "~/styles/app.css";

const PAGE_TITLES: Record<string, string> = {
  "/": "Call for Papers",
  "/applications": "Your proposals",
  "/apply": "Proposal draft",
  "/profile": "Speaker profile",
  "/settings": "Applicant settings",
  "/reviewer": "Reviewer queue",
  "/admin": "CFP administration",
  "/admin/staff": "Staff and gates",
};

type IdentityState = "checking" | "anonymous" | "verified" | "unavailable";

const pageTitle = (pathname: string) => PAGE_TITLES[pathname] ?? PAGE_TITLES[`/${pathname.split("/")[1]}`] ?? "Page not found";
const ariaCurrent = (current: boolean) => current ? "page" : undefined;
const isStaffPath = (pathname: string) => /^\/(admin|reviewer)(\/|$)/.test(pathname);

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
  onSettled(() => watchFieldErrors());
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  let toggle: HTMLButtonElement | undefined;
  let panel: HTMLElement | undefined;
  const closeNavigation = (refocus: boolean) => {
    setNavigationOpen(false);
    if (refocus) toggle?.focus();
  };
  const toggleNavigation = () => {
    if (navigationOpen()) return closeNavigation(false);
    setNavigationOpen(true);
    requestAnimationFrame(() => panel?.querySelector<HTMLElement>("a, button")?.focus());
  };
  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !navigationOpen()) return;
      event.preventDefault();
      closeNavigation(true);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (navigationOpen() && !panel?.contains(target) && !toggle?.contains(target)) closeNavigation(false);
    };
    const wide = window.matchMedia("(min-width: 48rem)");
    const onWide = (event: MediaQueryListEvent) => {
      if (event.matches) closeNavigation(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  });
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
        <img src="/logo.svg" alt="" width="36" height="46" />
        <span class="brand-lockup"><strong class="brand-name">WhatTheStack</strong><small class="brand-label">Call for Papers</small></span>
      </a>
      <button ref={(element) => { toggle = element; }} class="nav-toggle" type="button" aria-expanded={navigationOpen() ? "true" : "false"} aria-controls="primary-nav" onClick={toggleNavigation}>
        <span class="nav-toggle-label">Menu</span>
        <span class="nav-toggle-mark" aria-hidden="true" />
      </button>
      <nav ref={(element) => { panel = element; }} id="primary-nav" class="primary-nav" data-open={navigationOpen() ? "true" : undefined} aria-label="Main navigation" onClick={(event) => { if ((event.target as Element).closest("a")) closeNavigation(false); }}>
        <a href="/applications" aria-current={ariaCurrent(location.pathname.startsWith("/applications") || location.pathname.startsWith("/apply/"))}>Proposals</a>
        <Show when={account()}><a href="/profile" aria-current={ariaCurrent(location.pathname === "/profile")}>Profile</a><a href="/settings" aria-current={ariaCurrent(location.pathname === "/settings")}>Settings</a></Show>
        <Show when={staffAccess()?.roles.includes("reviewer")}><a href="/reviewer" aria-current={ariaCurrent(location.pathname.startsWith("/reviewer"))}>Review</a></Show>
        <Show when={staffAccess()?.roles.includes("admin")}><a href="/admin" aria-current={ariaCurrent(location.pathname.startsWith("/admin"))}>Admin</a></Show>
        {/* Phones: the identity action closes the panel as a full-width plate. Hidden at 768px and wider. */}
        <div class="menu-identity"><HeaderIdentity account={account()} identityState={identityState()} pathname={location.pathname} /></div>
      </nav>
      <HeaderIdentity account={account()} identityState={identityState()} pathname={location.pathname} />
    </header>
    <main id="main" class="page-main" data-surface={isStaffPath(location.pathname) ? "staff" : "applicant"}>{props.children}</main>
    <footer class="site-footer">
      <span class="site-footer-brand"><strong>WhatTheStack</strong> Call for Papers</span>
      <Show when={account()}><span class="account-id">Your WTS user ID <code>{account()?.wtsUserId}</code></span></Show>
      <a href="https://wts.sh" rel="external">Conference site</a>
    </footer>
  </div>;
}

export default function App() {
  return <Router>{(routeProps) => <ApplicantShell>{routeProps.children}</ApplicantShell>}</Router>;
}
