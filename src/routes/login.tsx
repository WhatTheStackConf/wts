import { createSignal, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/web";
import { Icon } from "~/components/Icon";
import { authFailure } from "~/lib/auth-errors";

const LoginPage = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [showResendVerification, setShowResendVerification] = createSignal(false);
  const [resendSuccess, setResendSuccess] = createSignal(false);
  const auth = useAuth();

  const completeLogin = () => {
    const redirectUrl = localStorage.getItem("redirect_url");
    localStorage.removeItem("redirect_url");
    if (redirectUrl) {
      try {
        const destination = new URL(redirectUrl, location.origin);
        if (destination.origin === location.origin) {
          location.href = `${destination.pathname}${destination.search}${destination.hash}`;
          return;
        }
      } catch {
        // Invalid or cross-origin redirects fall back to the site root.
      }
    }
    location.href = "/";
  };

  // If already logged in, redirect to the CfP page
  // if (typeof window !== "undefined" && auth && auth.record) {
  //   return navigate("/cfp/01-intro");
  // }

  const handleEmailLogin = async (e: Event) => {
    e.preventDefault();
    if (auth.isLoading()) return;
    setError("");
    setShowResendVerification(false);
    setResendSuccess(false);

    try {
      await auth?.login(email(), password());
      completeLogin();
    } catch (err) {
      const failure = authFailure(err, "password");
      setError(failure.message);
      setShowResendVerification(failure.code === "verification");
    }
  };

  const handleResendVerification = async () => {
    if (!email()) return;
    try {
      // Dynamic import to avoid issues if utils not loaded
      const { requestEmailVerification } = await import("~/lib/pocketbase-utils");
      const sent = await requestEmailVerification(email());
      if (!sent) {
        setError("We could not send the verification email. Please try again shortly or contact the WTS organizers.");
        return;
      }
      setResendSuccess(true);
      setError(""); // Clear the error to reduce visual noise
    } catch (err) {
      console.error("Resend error:", err);
      // We don't necessarily want to show an error here to prevent enumeration listing if possible,
      // but provided the user just tried to log in, it's fine.
    }
  };

  const loginWithGithub = async () => {
    if (auth.isLoading()) return;
    setError("");
    setShowResendVerification(false);
    try {
      await auth?.githubLogin();
      completeLogin();
    } catch (err) {
      setError(authFailure(err, "oauth").message);
    }
  };

  const loginWithGoogle = async () => {
    if (auth.isLoading()) return;
    setError("");
    setShowResendVerification(false);
    try {
      await auth?.googleLogin();
      completeLogin();
    } catch (err) {
      setError(authFailure(err, "oauth").message);
    }
  };

  return (
    <Layout
      title="Login"
      description="Log in to access the Call for Papers form"
    >
      <div class="container mx-auto px-4 py-8">
        <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6">
          <h1 class="text-2xl font-bold text-center mb-6">
            Log In to WhatTheStack
          </h1>

          <button
            type="button"
            onClick={loginWithGithub}
            disabled={auth.isLoading()}
            class="btn btn-primary w-full mb-4"
          >
            <Icon icon="mdi:github" class="mr-2" /> Log in with GitHub
          </button>

          <button
            type="button"
            onClick={loginWithGoogle}
            disabled={auth.isLoading()}
            class="btn btn-primary w-full mb-4"
          >
            <Icon icon="mdi:google" class="mr-2" /> Log in with Google
          </button>

          <form onSubmit={handleEmailLogin}>
            <div class="mb-4">
              <label for="email" class="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                autocomplete="username"
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
                autocomplete="current-password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="input input-bordered w-full"
                required
              />
            </div>

            <Show when={error()}>
              <div role="alert" class="mb-4 p-3 bg-error text-error-content rounded-lg">
                {error()}
              </div>
            </Show>

            <div class="flex flex-col gap-3">
              <button type="submit" class="btn btn-primary w-full" disabled={auth.isLoading()}>
                Log In
              </button>
            </div>
          </form>

          <div class="mt-2 text-right">
            <a href="/forgot-password" class="text-sm link link-secondary">
              Forgot Password?
            </a>
          </div>

          <Show when={showResendVerification()}>
            <div class="mt-4 p-4 bg-base-200 rounded-lg text-center">
              <p class="text-sm mb-3">Diidn't receive the verification email?</p>
              <button
                type="button"
                onClick={handleResendVerification}
                class="btn btn-outline btn-secondary btn-sm w-full"
                disabled={resendSuccess()}
              >
                {resendSuccess() ? "Email Sent!" : "Resend Verification Email"}
              </button>
              <Show when={resendSuccess()}>
                <p class="text-xs text-success mt-2">
                  Please check your inbox (and spam folder).
                </p>
              </Show>
            </div>
          </Show>

          <div class="mt-6 text-center">
            <p class="text-sm text-base-content/70">
              New account registration is closed. Existing users can still log in, including with Google or GitHub.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

// export default LoginPage;
export default clientOnly(async () => ({ default: LoginPage }), { lazy: true });
