import { createSignal, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import { Icon } from "@iconify-icon/solid";

const ForgotPasswordPage = () => {
    const [email, setEmail] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [success, setSuccess] = createSignal(false);
    const [error, setError] = createSignal("");

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const { requestPasswordReset } = await import("~/lib/pocketbase-utils");
            await requestPasswordReset(email());
            setSuccess(true);
        } catch (err: any) {
            console.error("Password reset error:", err);
            // We usually don't want to expose if an email was valid or not for security, 
            // but for a smooth UX we might want to catch network errors.
            // requestPasswordReset returns true/false or throws depending on implementation.
            // Our current implementation checks returns boolean false on catch, but we await it.
            // Let's assume it succeeded to prevent enumeration if it returns false.
            setSuccess(true);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout title="Reset Password" description="Request a password reset">
            <div class="container mx-auto px-4 py-8">
                <Show when={success()} fallback={
                    <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6">
                        <h1 class="text-2xl font-bold text-center mb-6">Reset Password</h1>
                        <p class="text-sm text-secondary-300 text-center mb-6">
                            Enter your email address and we'll send you a link to reset your password.
                        </p>

                        <form onSubmit={handleSubmit}>
                            <div class="mb-4">
                                <label for="email" class="block text-sm font-medium mb-1">
                                    Email Address
                                </label>
                                <input
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={email()}
                                    onInput={(e) => setEmail(e.currentTarget.value)}
                                    class="input input-bordered w-full"
                                    required
                                    placeholder="you@example.com"
                                />
                            </div>

                            <Show when={error()}>
                                <div class="mb-4 p-3 bg-error text-error-content rounded-lg">
                                    {error()}
                                </div>
                            </Show>

                            <button
                                type="submit"
                                class="btn btn-primary w-full"
                                disabled={loading()}
                            >
                                {loading() ? (
                                    <>
                                        <span class="loading loading-spinner"></span>
                                        Sending...
                                    </>
                                ) : (
                                    "Send Reset Link"
                                )}
                            </button>
                        </form>

                        <div class="mt-6 text-center">
                            <a href="/login" class="link link-secondary text-sm">
                                Back to Login
                            </a>
                        </div>
                    </div>
                }>
                    <div class="max-w-md mx-auto bg-base-100 rounded-lg shadow-xl p-6 text-center">
                        <div class="mb-4 text-success flex justify-center">
                            <Icon icon="mdi:email-check" width="64" />
                        </div>
                        <h1 class="text-2xl font-bold mb-4">Check Your Inbox</h1>
                        <p class="mb-6 text-secondary-300">
                            If an account exists for <strong>{email()}</strong>, we have sent instructions to reset your password.
                        </p>
                        <a href="/login" class="btn btn-outline btn-primary">
                            Return to Login
                        </a>
                    </div>
                </Show>
            </div>
        </Layout>
    );
};

export default ForgotPasswordPage;
