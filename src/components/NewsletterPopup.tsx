import { createSignal, onMount, onCleanup, createEffect, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import { clientOnly } from "@solidjs/start";

const NewsletterPopup = () => {
    const [isVisible, setIsVisible] = createSignal(false);
    const [email, setEmail] = createSignal("");
    const [name, setName] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [success, setSuccess] = createSignal(false);
    const [error, setError] = createSignal("");
    const [turnstileToken, setTurnstileToken] = createSignal("");
    const [turnstileReady, setTurnstileReady] = createSignal(false);
    let containerRef: HTMLDivElement | undefined;

    // Prevent double rendering
    let renderedWidgetId: string | null = null;

    const LIST_ID = import.meta.env.VITE_LISTMONK_LIST_ID;
    const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    const LISTMONK_URL = "https://listmonk.wts.sh";

    onMount(() => {
        console.log("[Newsletter] Config:", {
            hasListId: !!LIST_ID,
            hasSiteKey: !!SITE_KEY,
            turnstileLoaded: !!(window as any).turnstile
        });



        // Listen for manual trigger
        const handleOpen = () => setIsVisible(true);
        window.addEventListener("wts:open-newsletter", handleOpen);

        // Check if Turnstile is already loaded
        const checkTurnstile = () => {
            if ((window as any).turnstile) {
                setTurnstileReady(true);
                return true;
            }
            return false;
        };

        if (!checkTurnstile()) {
            // Poll for a bit just in case
            const interval = setInterval(() => {
                if (checkTurnstile()) clearInterval(interval);
            }, 100);
            setTimeout(() => clearInterval(interval), 5000);
        }

        // Inject Turnstile script
        if (SITE_KEY && !document.getElementById("turnstile-script")) {
            console.log("[Newsletter] Injecting Turnstile script...");
            const script = document.createElement("script");
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.id = "turnstile-script";
            script.async = true;
            script.defer = true;
            script.onload = () => {
                console.log("[Newsletter] Turnstile script loaded");
                setTurnstileReady(true);
            };
            document.head.appendChild(script);
        }

        onCleanup(() => {
            window.removeEventListener("wts:open-newsletter", handleOpen);
        });
    });

    // Render Turnstile when visible and ready
    createEffect(() => {
        if (!isVisible()) {
            renderedWidgetId = null;
            return;
        }

        if (isVisible() && !success() && SITE_KEY && turnstileReady() && (window as any).turnstile && containerRef) {
            if (renderedWidgetId) return; // Prevent duplicates

            console.log("[Newsletter] Attempting to render Turnstile...");
            // Tiny delay to ensure DOM is ready
            setTimeout(() => {
                try {
                    if (containerRef && !renderedWidgetId) {
                        // Clear to be safe
                        containerRef.innerHTML = "";

                        renderedWidgetId = (window as any).turnstile.render(containerRef, {
                            sitekey: SITE_KEY,
                            callback: (token: string) => {
                                console.log("[Newsletter] Verified");
                                setTurnstileToken(token);
                            },
                            "expired-callback": () => setTurnstileToken(""),
                            "error-callback": () => console.error("[Newsletter] Turnstile Error"),
                            theme: "dark",
                        });
                        console.log("[Newsletter] Rendered with ID:", renderedWidgetId);
                    }
                } catch (e) {
                    console.error("Turnstile render error", e);
                }
            }, 100);
        } else if (isVisible() && !SITE_KEY) {
            console.error("[Newsletter] VITE_TURNSTILE_SITE_KEY is missing! Widget cannot render.");
        }
    });

    const handleDismiss = () => {
        setIsVisible(false);
        localStorage.setItem("wts_newsletter_dismissed", "true");
    };

    const handleSubscribe = async (e: Event) => {
        e.preventDefault();
        if (!LIST_ID) {
            setError("Newsletter configuration missing (List ID).");
            return;
        }

        if (SITE_KEY && !turnstileToken()) {
            setError("Please complete the captcha.");
            return;
        }

        setLoading(true);
        setError("");

        try {
            // Listmonk public subscription endpoint
            // POST /api/public/subscription
            // Payload: { email, name, l: list_uuid }

            const response = await fetch(`${LISTMONK_URL}/api/public/subscription`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: email(),
                    name: name(),
                    l: LIST_ID,
                    turnstile_response: turnstileToken()
                    // 'confirm': true // Optional: if you want to skip double opt-in if allowed by server settings, usually not exposed publicly
                }),
            });

            if (!response.ok) {
                throw new Error("Failed to subscribe. Please try again.");
            }

            setSuccess(true);

            // Mark as dismissed so they don't see it again
            localStorage.setItem("wts_newsletter_dismissed", "true");

            // Auto clear after a few seconds
            setTimeout(() => {
                setIsVisible(false);
            }, 3000);

        } catch (err: any) {
            console.error("Newsletter error:", err);
            setError(err.message || "Something went wrong.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Show when={isVisible()}>
            <div class="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                {/* Backdrop */}
                <div
                    class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                    onClick={handleDismiss}
                ></div>

                {/* Modal Content */}
                <div class="relative w-full max-w-md bg-base-100/90 backdrop-blur-xl border border-primary-500/30 shadow-[0_0_50px_rgba(var(--color-primary-500),0.2)] rounded-2xl p-6 md:p-8 overflow-hidden">

                    {/* Decorative elements */}
                    <div class="absolute top-0 right-0 w-32 h-32 bg-primary-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                    <div class="absolute bottom-0 left-0 w-24 h-24 bg-secondary-500/10 rounded-full blur-2xl -ml-12 -mb-12 pointer-events-none"></div>

                    {/* Close button */}
                    <button
                        onClick={handleDismiss}
                        class="absolute top-4 right-4 text-base-content/50 hover:text-white transition-colors p-1"
                    >
                        <Icon icon="mdi:close" width="24" />
                    </button>

                    <Show when={success()}>
                        <div class="text-center py-8">
                            <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/20 text-success mb-4">
                                <Icon icon="mdi:email-check" width="32" />
                            </div>
                            <h3 class="text-2xl font-bold font-star text-white mb-2">Subscribed!</h3>
                            <p class="text-secondary-300">
                                Thanks for joining. Check your inbox for confirmation.
                            </p>
                        </div>
                    </Show>

                    <Show when={!success()}>
                        <div class="text-center mb-6">
                            <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-500/20 text-primary-400 mb-4">
                                <Icon icon="mdi:email-fast-outline" width="28" />
                            </div>
                            <h3 class="text-2xl font-bold font-star text-white mb-2">STAY UPDATED</h3>
                            <p class="text-secondary-300 text-sm">
                                Get the latest news about speakers, tickets, and schedule for WhatTheStack 2026. No spam, we promise.
                            </p>
                        </div>

                        <form onSubmit={handleSubscribe} class="flex flex-col gap-4">
                            {/* Turnstile Container */}
                            <div ref={containerRef} class="flex justify-center min-h-[65px] mb-4"></div>

                            <Show when={!!turnstileToken()}>
                                <div class="form-control">
                                    <input
                                        type="text"
                                        placeholder="Your Name (Optional)"
                                        class="input input-bordered bg-base-200/50 focus:bg-base-200 w-full"
                                        value={name()}
                                        onInput={(e) => setName(e.currentTarget.value)}
                                    />
                                </div>

                                <div class="form-control">
                                    <input
                                        type="email"
                                        placeholder="your@email.com"
                                        class="input input-bordered bg-base-200/50 focus:bg-base-200 w-full"
                                        value={email()}
                                        onInput={(e) => setEmail(e.currentTarget.value)}
                                        required
                                    />
                                </div>

                                <Show when={error()}>
                                    <div class="text-error text-xs text-center">
                                        {error()}
                                    </div>
                                </Show>

                                <button
                                    type="submit"
                                    class="btn btn-primary w-full shadow-lg shadow-primary-500/20"
                                    disabled={loading()}
                                >
                                    {loading() ? (
                                        <span class="loading loading-spinner loading-sm"></span>
                                    ) : (
                                        <>
                                            Subscribe <Icon icon="mdi:arrow-right" />
                                        </>
                                    )}
                                </button>
                                <p class="text-[10px] text-center text-base-content/40 mt-2">
                                    We use Listmonk for our newsletter. Unsubscribe at any time.
                                </p>
                            </Show>
                        </form>
                    </Show>
                </div>
            </div>
        </Show >
    );
};

export default NewsletterPopup;
