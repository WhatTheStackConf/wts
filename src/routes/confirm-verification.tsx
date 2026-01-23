import { createSignal, onMount, Show } from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { Icon } from "@iconify-icon/solid";
import { clientOnly } from "@solidjs/start";

const ConfirmVerificationPage = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = createSignal<"verifying" | "success" | "error">(
    "verifying",
  );
  const [error, setError] = createSignal("");
  const navigate = useNavigate();

  onMount(async () => {
    const token = searchParams.token;
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }

    try {
      const { confirmVerification, pb } =
        await import("~/lib/pocketbase-utils");

      // Confirm verification
      await confirmVerification(token as string);

      // Check if we also get auth token essentially logging us in (PB behavior varies by version)
      // But usually we just redirect to login or check if there is an active session

      setStatus("success");

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate("/login");
      }, 3000);
    } catch (err: any) {
      console.error("Verification error:", err);
      setStatus("error");
      setError(
        err.message ||
          "Failed to verify email. The token may be invalid or expired.",
      );
    }
  });

  return (
    <Layout
      title="Email Verification"
      description="Verifying your email address"
    >
      <div class="container mx-auto px-4 py-8">
        <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-8 text-center">
          <Show when={status() === "verifying"}>
            <div class="flex flex-col items-center">
              <span class="loading loading-spinner loading-lg text-primary mb-4"></span>
              <h1 class="text-xl font-bold">Verifying Email...</h1>
              <p class="text-base-content/70 mt-2">
                Please wait while we verify your email address.
              </p>
            </div>
          </Show>

          <Show when={status() === "success"}>
            <div class="flex flex-col items-center">
              <div class="w-16 h-16 bg-success/20 rounded-full flex items-center justify-center text-success mb-4">
                <Icon icon="mdi:check-circle" width="40" />
              </div>
              <h1 class="text-2xl font-bold text-success mb-2">
                Email Verified!
              </h1>
              <p class="mb-6">
                Your email has been successfully verified. You can now access
                all features.
              </p>
              <p class="mb-6 text-sm text-base-content/70">
                Redirecting to login in 3 seconds...
              </p>
              <a href="/login" class="btn btn-primary w-full">
                Go to Login
              </a>
            </div>
          </Show>

          <Show when={status() === "error"}>
            <div class="flex flex-col items-center">
              <div class="w-16 h-16 bg-error/20 rounded-full flex items-center justify-center text-error mb-4">
                <Icon icon="mdi:alert-circle" width="40" />
              </div>
              <h1 class="text-xl font-bold text-error mb-2">
                Verification Failed
              </h1>
              <p class="text-base-content/70 mb-4">{error()}</p>
              <a href="/login" class="btn btn-outline w-full">
                Return to Login
              </a>
            </div>
          </Show>
        </div>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: ConfirmVerificationPage }), {
  lazy: true,
});
