import { createEffect, createSignal, onCleanup, onSettled, Show } from "solid-js";
import { Icon } from "~/components/Icon";
import "~/styles/newsletter.css";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "dark" | "light";
      size: "compact";
    },
  ): string;
  reset(widgetId: string): void;
  remove?(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface NewsletterPopupProps {
  appearance?: "light";
}

const NewsletterPopup = (props: NewsletterPopupProps) => {
  const [isVisible, setIsVisible] = createSignal(false);
  const [email, setEmail] = createSignal("");
  const [name, setName] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [success, setSuccess] = createSignal(false);
  const [error, setError] = createSignal("");
  const [turnstileToken, setTurnstileToken] = createSignal("");
  const [turnstileReady, setTurnstileReady] = createSignal(false);
  let dialogRef: HTMLDialogElement | undefined;
  let emailRef: HTMLInputElement | undefined;
  let turnstileRef: HTMLDivElement | undefined;
  let opener: HTMLElement | null = null;
  let renderedWidgetId: string | null = null;
  let renderTimer: number | undefined;
  let alive = true;

  const LIST_ID = import.meta.env.VITE_LISTMONK_LIST_ID;
  const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const LISTMONK_URL = "https://listmonk.wts.sh";

  const loadTurnstile = () => {
    if (!SITE_KEY) return;
    if (window.turnstile) {
      setTurnstileReady(true);
      return;
    }

    const existingScript = document.getElementById("turnstile-script") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", onTurnstileLoad);
      existingScript.addEventListener("error", onTurnstileError);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.id = "turnstile-script";
    script.async = true;
    script.fetchPriority = "low";
    script.addEventListener("load", onTurnstileLoad);
    script.addEventListener("error", onTurnstileError);
    document.head.appendChild(script);
  };

  const onTurnstileLoad = () => {
    if (alive) setTurnstileReady(true);
  };
  const onTurnstileError = () => {
    if (alive) setError("The security check could not load. Please try again later.");
  };

  const renderTurnstile = () => {
    if (!SITE_KEY || !turnstileReady() || !isVisible() || !turnstileRef || renderedWidgetId || !window.turnstile) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = undefined;
      if (!alive || !isVisible() || !turnstileRef || !window.turnstile || renderedWidgetId) return;
      try {
        renderedWidgetId = window.turnstile.render(turnstileRef, {
          sitekey: SITE_KEY,
          callback: (token) => {
            if (alive) {
              setTurnstileToken(token);
              setError("");
            }
          },
          "expired-callback": () => {
            if (alive) setTurnstileToken("");
          },
          "error-callback": () => {
            if (alive) {
              setTurnstileToken("");
              setError("The security check could not load. Please try again.");
            }
          },
          theme: props.appearance === "light" ? "light" : "dark",
          size: "compact",
        });
      } catch {
        if (alive) setError("The security check could not load. Please try again.");
      }
    }, 100);
  };

  const openDialog = () => {
    if (!dialogRef || dialogRef.open) return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsVisible(true);
    dialogRef.showModal();
    queueMicrotask(() => emailRef?.focus());
    loadTurnstile();
    renderTurnstile();
  };

  const handleDismiss = () => {
    if (!dialogRef?.open) return;
    dialogRef.close();
  };

  const handleDialogClose = () => {
    setIsVisible(false);
    if (renderTimer !== undefined) {
      window.clearTimeout(renderTimer);
      renderTimer = undefined;
    }
    if (renderedWidgetId && window.turnstile?.remove) {
      window.turnstile.remove(renderedWidgetId);
      renderedWidgetId = null;
    }
    setTurnstileToken("");
    const previousOpener = opener;
    opener = null;
    if (previousOpener?.isConnected) previousOpener.focus();
  };
  const resetChallenge = () => {
    if (!SITE_KEY) return;
    setTurnstileToken("");
    if (!renderedWidgetId || !window.turnstile) return;
    try {
      window.turnstile.reset(renderedWidgetId);
    } catch {
      window.turnstile.remove?.(renderedWidgetId);
      renderedWidgetId = null;
      if (turnstileRef) turnstileRef.innerHTML = "";
      renderTurnstile();
    }
  };


  onSettled(() => {
    window.addEventListener("wts:open-newsletter", openDialog);
    const existingScript = document.getElementById("turnstile-script");
    existingScript?.addEventListener("load", onTurnstileLoad);
    existingScript?.addEventListener("error", onTurnstileError);
    return () => {
      window.removeEventListener("wts:open-newsletter", openDialog);
      existingScript?.removeEventListener("load", onTurnstileLoad);
      existingScript?.removeEventListener("error", onTurnstileError);
    };
  });

  onCleanup(() => {
    alive = false;
    if (renderTimer !== undefined) window.clearTimeout(renderTimer);
    const script = document.getElementById("turnstile-script");
    script?.removeEventListener("load", onTurnstileLoad);
    script?.removeEventListener("error", onTurnstileError);
    if (renderedWidgetId && window.turnstile?.remove) window.turnstile.remove(renderedWidgetId);
  });

  createEffect(
    () => ({ ready: turnstileReady(), visible: isVisible() }),
    ({ ready, visible }) => {
      if (ready && visible) renderTurnstile();
    },
  );

  const handleSubscribe = async (event: SubmitEvent) => {
    event.preventDefault();
    if (loading() || success()) return;
    if (!LIST_ID) {
      setError("Newsletter sign-up is currently unavailable. Please check back later.");
      return;
    }
    if (SITE_KEY && !turnstileToken()) {
      setError("Please complete the security check before subscribing.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${LISTMONK_URL}/api/public/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email(),
          name: name(),
          l: LIST_ID,
          turnstile_response: turnstileToken(),
        }),
      });
      if (!response.ok) throw new Error("We couldn't add you to the newsletter. Please try again.");
      if (alive) setSuccess(true);
    } catch {
      if (alive) {
        resetChallenge();
        setError("We couldn’t confirm your subscription. Check your inbox before trying again.");
      }
    } finally {
      if (alive) setLoading(false);
    }
  };

  return (
    <dialog
      ref={(element) => { dialogRef = element; }}
      class="newsletter-dialog"
      data-newsletter-appearance={props.appearance === "light" ? "light" : "dark"}
      aria-labelledby="newsletter-title"
      aria-describedby="newsletter-description"
      onClose={handleDialogClose}
      onClick={(event) => {
        if (event.target === dialogRef) handleDismiss();
      }}
    >
      <section class="newsletter-panel">
        <button type="button" class="btn btn-square btn-ghost newsletter-close" onClick={handleDismiss} aria-label="Close newsletter sign-up">
          <Icon icon="ph:x-bold" width="20" height="20" aria-hidden="true" />
        </button>
        <Show when={success()} fallback={
          <>
            <h2 id="newsletter-title" class="newsletter-title">Conference updates</h2>
            <p id="newsletter-description" class="newsletter-description">
              Get occasional news about WTS and the software community. You can unsubscribe at any time.
            </p>
            <Show when={!LIST_ID}>
              <p class="newsletter-unavailable" role="status">Newsletter sign-up is currently unavailable. Please check back later.</p>
            </Show>
            <form class="newsletter-form" onSubmit={handleSubscribe} aria-busy={loading() ? "true" : "false"}>
              <Show when={SITE_KEY}>
                <div ref={(element) => { turnstileRef = element; }} class="newsletter-challenge" aria-label="Security check"></div>
              </Show>
              <label class="newsletter-field">
                <span>Email address (required)</span>
                <input class="input input-bordered"
                  ref={(element) => { emailRef = element; }}
                  type="email"
                  name="email"
                  autocomplete="email"
                  required
                  value={email()}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                  disabled={loading()}
                />
              </label>
              <label class="newsletter-field">
                <span>Name <span class="newsletter-optional">(optional)</span></span>
                <input class="input input-bordered"
                  type="text"
                  name="name"
                  autocomplete="name"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  disabled={loading()}
                />
              </label>
              <Show when={error()}>
                <p class="newsletter-error" role="alert">{error()}</p>
              </Show>
              <button class="btn btn-primary newsletter-submit" type="submit" disabled={loading() || !LIST_ID}>
                <Show when={loading()} fallback="Subscribe">Submitting…</Show>
              </button>
              <Show when={loading()}>
                <p class="newsletter-pending" role="status">Submitting your request. Closing this window will not cancel it.</p>
              </Show>
            </form>
          </>
        }>
          <h2 id="newsletter-title" class="newsletter-title">Check your inbox</h2>
          <p id="newsletter-description" class="newsletter-description" role="status">
            Thanks for joining. Check your inbox for a confirmation email.
          </p>
        </Show>
      </section>
    </dialog>
  );
};

export default NewsletterPopup;
