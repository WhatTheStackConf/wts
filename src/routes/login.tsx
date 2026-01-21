import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";

const LoginPage = () => {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const auth = useAuth();
  const navigate = useNavigate();

  // If already logged in, redirect to the CfP page
  // if (typeof window !== "undefined" && auth && auth.record) {
  //   return navigate("/cfp/01-intro");
  // }

  const handleEmailLogin = async (e: Event) => {
    e.preventDefault();
    setError("");

    try {
      const data = await auth?.login(email(), password());

      // Enforce email verification
      if (!data?.record?.verified) {
        auth?.logout();
        setError("Please verify your email address before logging in.");
        return;
      }

      const redirectUrl = localStorage.getItem("redirect_url");
      if (redirectUrl) {
        localStorage.removeItem("redirect_url");
        location.href = redirectUrl;
      } else {
        location.href = "/";
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Login failed");
    }
  };

  const loginWithGithub = async () => {
    try {
      await auth?.githubLogin();
      const redirectUrl = localStorage.getItem("redirect_url");
      if (redirectUrl) {
        localStorage.removeItem("redirect_url");
        location.href = redirectUrl;
      } else {
        location.href = "/";
      }
    } catch (err: any) {
      console.error("Login error:", err);
      setError(err.message || "Login failed");
    }
  };

  // const loginWithGoogle = async () => {
  //   try {
  //     await auth?.googleLogin();
  //     navigate("/");
  //   } catch (err: any) {
  //     console.error("Login error:", err);
  //     setError(err.message || "Login failed");
  //   }
  // };

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
            class="btn btn-primary w-full mb-4"
          >
            <Icon icon="mdi:github" class="mr-2" /> Log in with GitHub
          </button>

          {/*<button
            type="button"
            onClick={loginWithGoogle}
            class="btn btn-primary w-full mb-4"
          >
            <Icon icon="mdi:google" class="mr-2" /> Log in with Google
          </button>*/}

          <form onSubmit={handleEmailLogin}>
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

            <Show when={error()}>
              <div class="mb-4 p-3 bg-error text-error-content rounded-lg">
                {error()}
              </div>
            </Show>

            <div class="flex flex-col gap-3">
              <button type="submit" class="btn btn-primary w-full">
                Log In
              </button>
            </div>
          </form>

          <div class="mt-6 text-center">
            <p class="text-sm text-base-content/70">
              Don't have an account?{" "}
              <a href="/register" class="link link-primary">
                Register
              </a>
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
};

// export default LoginPage;
export default clientOnly(async () => ({ default: LoginPage }), { lazy: true });
