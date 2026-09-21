export type AuthOperation = "password" | "oauth" | "register";
export type AuthErrorCode = "credentials" | "verification" | "session" | "validation" | "rate_limit" | "network" | "cancelled" | "unavailable";
export interface AuthFailure {
  code: AuthErrorCode;
  message: string;
}
export type AuthResult<T> = { ok: true; user: T } | { ok: false; error: AuthFailure };

export class AuthFlowError extends Error {
  constructor(readonly failure: AuthFailure) {
    super(failure.message);
  }
}

export function unwrapAuthResult<T>(result: AuthResult<T>): T {
  if (!result.ok) throw new AuthFlowError(result.error);
  return result.user;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Allowlisted public messages only: never echo upstream messages, tokens or data. */
export function authFailure(error: unknown, operation: AuthOperation): AuthFailure {
  if (error instanceof AuthFlowError) return error.failure;
  const details = object(error);
  const status = Number(details.status);
  if (details.isAbort === true) return { code: "cancelled", message: "Sign-in was cancelled. Please try again and keep the sign-in window open." };
  if (status === 429) return { code: "rate_limit", message: "Too many attempts. Please wait a few minutes before trying again." };
  if (status === 403 && (operation === "register" || operation === "oauth")) {
    return { code: "validation", message: "New account registration is closed. If you already have an account, use your original sign-in method." };
  }
  if (status === 0) return { code: "network", message: "Could not reach the sign-in service. Check your connection and try again." };
  if (error instanceof Error && error.message === "Please verify your email address before logging in.") {
    return { code: "verification", message: error.message };
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return { code: "session", message: "We could not establish your sign-in session. Refresh this page and try again. If this continues, contact the WTS organizers." };
  }
  if (operation === "password" && [400, 401, 403].includes(status)) {
    return { code: "credentials", message: "Could not log in with that email and password. Check your details, use your original Google/GitHub sign-in, or choose Forgot Password." };
  }
  if (operation === "register" && status === 400) {
    const fields = object(object(details.response).data);
    if (object(fields.email).code === "validation_not_unique") {
      // Keep recovery conditional rather than publicly confirming an account.
      return { code: "validation", message: "Unable to register with these details. If you already used Google, GitHub or this email, try logging in or use Forgot Password." };
    }
    if (fields.password) return { code: "validation", message: "Please choose a password with at least 8 characters." };
    if (fields.passwordConfirm) return { code: "validation", message: "Please make sure both passwords match." };
    if (fields.email) return { code: "validation", message: "Please enter a valid email address." };
    if (fields.name) return { code: "validation", message: "Please check your full name and try again." };
    return { code: "validation", message: "We could not create your account. Check your details, or try logging in if you have already registered." };
  }
  return {
    code: "unavailable",
    message: operation === "register"
      ? "We could not complete registration. Please try again shortly. If you may already have an account, try logging in; otherwise contact the WTS organizers."
      : "We could not complete sign-in. Please try again shortly. If this continues, contact the WTS organizers.",
  };
}
