import { describe, expect, it } from "vite-plus/test";
import { AuthFlowError, authFailure, type AuthOperation } from "~/lib/auth-errors";

const registrationError = (data: Record<string, unknown>) => ({ status: 400, response: { data } });

describe("authFailure", () => {
  it.each<[string, unknown, AuthOperation, string, string]>([
    ["abort", { status: 400, isAbort: true }, "password", "cancelled", "Sign-in was cancelled. Please try again and keep the sign-in window open."],
    ["rate limit", { status: 429 }, "register", "rate_limit", "Too many attempts. Please wait a few minutes before trying again."],
    ["network", { status: 0 }, "password", "network", "Could not reach the sign-in service. Check your connection and try again."],
    ["unverified email", new Error("Please verify your email address before logging in."), "password", "verification", "Please verify your email address before logging in."],
    ["missing session", new Error("Unauthorized"), "oauth", "session", "We could not establish your sign-in session. Refresh this page and try again. If this continues, contact the WTS organizers."],
    ["bad password login", { status: 403 }, "password", "credentials", "Could not log in with that email and password. Check your details, use your original Google/GitHub sign-in, or choose Forgot Password."],
    ["oauth 401", { status: 401 }, "oauth", "unavailable", "We could not complete sign-in. Please try again shortly. If this continues, contact the WTS organizers."],
    ["taken email", registrationError({ email: { code: "validation_not_unique" }, password: {} }), "register", "validation", "Unable to register with these details. If you already used Google, GitHub or this email, try logging in or use Forgot Password."],
    ["password field", registrationError({ name: {}, password: {} }), "register", "validation", "Please choose a password with at least 8 characters."],
    ["confirm field", registrationError({ name: {}, passwordConfirm: {} }), "register", "validation", "Please make sure both passwords match."],
    ["email field", registrationError({ name: {}, email: { code: "validation_invalid_email" } }), "register", "validation", "Please enter a valid email address."],
    ["name field", registrationError({ name: {} }), "register", "validation", "Please check your full name and try again."],
    ["empty field value", registrationError({ password: "" }), "register", "validation", "We could not create your account. Check your details, or try logging in if you have already registered."],
    ["register 500", { status: 500 }, "register", "unavailable", "We could not complete registration. Please try again shortly. If you may already have an account, try logging in; otherwise contact the WTS organizers."],
    ["plain string", "boom", "password", "unavailable", "We could not complete sign-in. Please try again shortly. If this continues, contact the WTS organizers."],
  ])("maps %s", (_name, error, operation, code, message) => {
    expect(authFailure(error, operation)).toEqual({ code, message });
  });

  it("passes an existing flow failure through", () => {
    const failure = { code: "session" as const, message: "Already mapped." };
    expect(authFailure(new AuthFlowError(failure), "register")).toBe(failure);
  });
});
