import { createSignal, createEffect, onMount, Show } from "solid-js";
import { Navigate, useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";

const RegisterPage = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [passwordConfirm, setPasswordConfirm] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = createSignal("");
  const [turnstileReady, setTurnstileReady] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let renderedWidgetId: string | null = null;
  const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  const auth = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect to the home page
  if (auth && auth.record) {
    return <Navigate href="/" />;
  }

  onMount(() => {
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
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.id = "turnstile-script";
      script.async = true;
      script.defer = true;
      script.onload = () => {
        setTurnstileReady(true);
      };
      document.head.appendChild(script);
    }
  });

  // Render Turnstile when visible and ready
  createEffect(() => {
    if (
      !success() &&
      SITE_KEY &&
      turnstileReady() &&
      (window as any).turnstile &&
      containerRef
    ) {
      if (renderedWidgetId) return; // Prevent duplicates

      // Tiny delay to ensure DOM is ready
      setTimeout(() => {
        try {
          if (containerRef && !renderedWidgetId) {
            // Clear to be safe
            containerRef.innerHTML = "";

            renderedWidgetId = (window as any).turnstile.render(containerRef, {
              sitekey: SITE_KEY,
              callback: (token: string) => {
                setTurnstileToken(token);
              },
              "expired-callback": () => setTurnstileToken(""),
              "error-callback": () => { },
              theme: "dark",
            });
          }
        } catch (e) {
          console.error("Turnstile render error", e);
        }
      }, 100);
    }
  });

  const handleRegister = async (e: Event) => {
    e.preventDefault();
    if (loading()) return;

    setLoading(true);
    setError("");

    if (password() !== passwordConfirm()) {
      setError("Passwords do not match");
      return;
    }

    try {
      // Import the register function from the auth utils
      const { register, requestEmailVerification } = await import("~/lib/pocketbase-utils");
      await register(email(), password(), passwordConfirm(), name());

      // Trigger email verification
      await requestEmailVerification(email());

      setSuccess(true);
    } catch (err: any) {
      console.error("Registration error:", err);
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (success()) {
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    }
  });

  return (
    <Layout
      title="Register"
      description="Create an account to access the Call for Papers form"
    >
      <div class="container mx-auto px-4 py-8">
        <Show when={success()} fallback={
          <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6">
            <h1 class="text-2xl font-bold text-center mb-6">Create an Account</h1>

            <form onSubmit={handleRegister}>
              <div class="mb-6 flex justify-center min-h-[65px]">
                <div ref={containerRef}></div>
              </div>

              <Show when={!!turnstileToken()}>
                <div class="mb-4">
                  <label for="name" class="block text-sm font-medium mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                    class="input input-bordered w-full"
                    required
                  />
                </div>

                <div class="mb-4">
                  <label for="email" class="block text-sm font-medium mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                    class="input input-bordered w-full"
                    required
                  />
                </div>

                <div class="mb-4">
                  <label for="password" class="block text-sm font-medium mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    class="input input-bordered w-full"
                    required
                  />
                </div>

                <div class="mb-4">
                  <label
                    for="passwordConfirm"
                    class="block text-sm font-medium mb-1"
                  >
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    id="passwordConfirm"
                    name="passwordConfirm"
                    value={passwordConfirm()}
                    onInput={(e) => setPasswordConfirm(e.currentTarget.value)}
                    class="input input-bordered w-full"
                    required
                  />
                </div>
              </Show>

              <Show when={error()}>
                <div class="mb-4 p-3 bg-error text-error-content rounded-lg">
                  {error()}
                </div>
              </Show>

              <button
                type="submit"
                class="btn btn-primary w-full"
                disabled={loading() || !turnstileToken()}
              >
                {loading() ? (
                  <>
                    <span class="loading loading-spinner"></span>
                    Creating Account...
                  </>
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            <div class="mt-6 text-center">
              <p class="text-sm text-base-content/70">
                Already have an account?{" "}
                <a href="/login" class="link link-primary">
                  Log in
                </a>
              </p>
            </div>
          </div>}>
          <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6 text-center">
            <h1 class="text-2xl font-bold mb-4">Registration Successful!</h1>
            <p class="mb-6">
              Your account has been created. <br />
              <span class="font-bold text-primary-500">Please check your email to verify your account.</span>
            </p>
            <p class="mb-6 text-sm text-base-content/70">
              Redirecting to login in 3 seconds...
            </p>
            <a href="/login" class="btn btn-primary">
              Go to Login Now
            </a>
          </div>
        </Show>
      </div>
    </Layout>
  );
};

export default RegisterPage;
