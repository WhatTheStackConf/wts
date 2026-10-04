import { createSignal, Show } from "solid-js";
import type { ActionResult } from "~/lib/account-model";
import type { JSX } from "@solidjs/web";

export type AdminFailureState = "unauthenticated" | "denied" | "not-found" | "stale" | "last-admin" | "unavailable";

export function AdminLoading(props: { label: string }) {
  return <div class="cfp-loading" role="status" aria-live="polite">{props.label}</div>;
}

export function AdminStatus(props: { state: string; label: string }) {
  const colorState = () => props.state === "accepted" || props.state === "active" ? "active" : props.state === "pending" ? "pending" : props.state === "rejected" || props.state === "revoked" || props.state === "disabled_restore" || props.state === "closed" ? "closed" : "neutral";
  return <span class="cfp-status" data-state={colorState()}>{props.label}</span>;
}

export function AdminSection(props: { title: string; description?: string; children: JSX.Element }) {
  return <section class="surface cfp-stack" aria-label={props.title}>
    <div class="surface-title"><div><h2>{props.title}</h2><Show when={props.description}><p>{props.description}</p></Show></div></div>
    {props.children}
  </section>;
}

export function AdminError(props: { state: AdminFailureState; message?: string; onRetry?: () => void }) {
  const copy: Record<AdminFailureState, { title: string; body: string }> = {
    unauthenticated: { title: "Sign-in required", body: "Sign in with a verified WTS identity to access CFP administration." },
    denied: { title: "Access denied", body: "Your current edition staff role does not permit this view. Protected CFP details are hidden." },
    "not-found": { title: "Not found", body: "This CFP resource is not available in the active edition." },
    stale: { title: "State changed", body: "The revision witness is stale. Reload the current edition data before you retry." },
    "last-admin": { title: "Final administrator retained", body: "This edition must keep one active administrator. Add another administrator before you revoke this grant." },
    unavailable: { title: "CFP service unavailable", body: "The request could not be verified. Your saved CFP data remains unchanged." },
  };
  return <div class="alert" role="alert">
    <div><h2>{copy[props.state].title}</h2><p>{props.message || copy[props.state].body}</p></div>
    <Show when={props.onRetry}><button type="button" class="button button-secondary button-small" onClick={props.onRetry}>Reload current data</button></Show>
    <Show when={props.state === "unauthenticated"}><a class="button button-small" href="/auth/login?returnTo=%2Fadmin" rel="external">Sign in</a></Show>
  </div>;
}

export function useAdminRequest() {
  const [error, setError] = createSignal<{ code: string; message: string }>();
  const [savedMessage, setSavedMessage] = createSignal("");
  const run = async <T,>(operation: () => Promise<ActionResult<T>>): Promise<ActionResult<T> | undefined> => {
    setSavedMessage("");
    try {
      const result = await operation();
      if (!result.ok) setError({ code: result.error.code, message: result.error.message });
      else setError(undefined);
      return result;
    } catch {
      setError({ code: "unavailable", message: "The request could not be completed. Retry after the service is available." });
      return undefined;
    }
  };
  return {
    error,
    savedMessage,
    run,
    setError: (value: { code: string; message: string }) => { setError(value); },
    clear: () => { setError(undefined); setSavedMessage(""); },
    saved: (message: string) => { setError(undefined); setSavedMessage(message); },
  };
}
