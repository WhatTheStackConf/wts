import { createSignal, Show, onMount } from "solid-js";
import { useSearchParams, useNavigate } from "@solidjs/router";
import { Layout } from "~/layouts/Layout";
import { Icon } from "@iconify-icon/solid";

const ConfirmPasswordResetPage = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    // We assume the token comes as a query param 'token' (default PB behavior usually puts it in fragment or query)
    // Adjust based on your PB email template. Usually it's ?token=... or /confirm-password-reset/TOKEN
    // Here we'll support query param `token`
    const token = () => {
        const t = searchParams.token;
        return Array.isArray(t) ? t[0] : (t || "");
    };

    const [password, setPassword] = createSignal("");
    const [passwordConfirm, setPasswordConfirm] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [success, setSuccess] = createSignal(false);
    const [error, setError] = createSignal("");

    onMount(() => {
        if (!token()) {
            setError("Invalid or missing reset token.");
        }
    });

    const handleSubmit = async (e: Event) => {
        e.preventDefault();

        if (password() !== passwordConfirm()) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const { confirmPasswordReset } = await import("~/lib/pocketbase-utils");
            await confirmPasswordReset(token(), password(), passwordConfirm());
            setSuccess(true);

            // Auto redirect
            setTimeout(() => {
                navigate("/login");
            }, 3000);
        } catch (err: any) {
            console.error("Password reset confirmation error:", err);
            setError(err.message || "Failed to reset password. The link may have expired.");
        } finally {
            setLoading(false);
        }
    };

    if (success()) {
        return (
            <Layout title="Password Reset Successful" description="Your password has been reset">
                <div class="container mx-auto px-4 py-8">
                    <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6 text-center">
                        <div class="mb-4 text-success flex justify-center">
                            <Icon icon="mdi:check-circle" width="64" />
                        </div>
                        <h1 class="text-2xl font-bold mb-4">Password Reset!</h1>
                        <p class="mb-6 text-secondary-300">
                            Your password has been successfully updated. You can now log in with your new password.
                        </p>
                        <p class="text-sm opacity-70 mb-6">Redirecting to login...</p>
                        <a href="/login" class="btn btn-primary">
                            Go to Login
                        </a>
                    </div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout title="Set New Password" description="Enter your new password">
            <div class="container mx-auto px-4 py-8">
                <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6">
                    <h1 class="text-2xl font-bold text-center mb-6">Set New Password</h1>

                    <Show when={error()}>
                        <div class="mb-6 p-3 bg-error text-error-content rounded-lg flex items-start gap-2">
                            <Icon icon="mdi:alert-circle" class="mt-1" />
                            <span>{error()}</span>
                        </div>
                    </Show>

                    <Show when={!success() && (token() || error())}>
                        {/* Only show form if we have a token (or if we had an error but want to keep form visible, though token error disables it implicitly via validation logic if we added it, but good enough) */}
                        <form onSubmit={handleSubmit}>
                            <div class="mb-4">
                                <label for="password" class="block text-sm font-medium mb-1">
                                    New Password
                                </label>
                                <input
                                    type="password"
                                    id="password"
                                    name="password"
                                    value={password()}
                                    onInput={(e) => setPassword(e.currentTarget.value)}
                                    class="input input-bordered w-full"
                                    required
                                    minLength={8}
                                    disabled={!!error() && !token()} // Disable if missing token
                                />
                            </div>

                            <div class="mb-6">
                                <label for="passwordConfirm" class="block text-sm font-medium mb-1">
                                    Confirm New Password
                                </label>
                                <input
                                    type="password"
                                    id="passwordConfirm"
                                    name="passwordConfirm"
                                    value={passwordConfirm()}
                                    onInput={(e) => setPasswordConfirm(e.currentTarget.value)}
                                    class="input input-bordered w-full"
                                    required
                                    minLength={8}
                                    disabled={!!error() && !token()}
                                />
                            </div>

                            <button
                                type="submit"
                                class="btn btn-primary w-full"
                                disabled={loading() || (!!error() && !token())}
                            >
                                {loading() ? (
                                    <>
                                        <span class="loading loading-spinner"></span>
                                        Updating Password...
                                    </>
                                ) : (
                                    "Reset Password"
                                )}
                            </button>
                        </form>
                    </Show>

                    <Show when={!token() && error()}>
                        <div class="mt-6 text-center">
                            <a href="/forgot-password" class="btn btn-outline btn-secondary">
                                Request New Link
                            </a>
                        </div>
                    </Show>

                    <div class="mt-6 text-center">
                        <a href="/login" class="link link-secondary text-sm">
                            Back to Login
                        </a>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default ConfirmPasswordResetPage;
