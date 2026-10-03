"use strict";

class AccountRequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const errors = {
  INVALID_EMAIL_OR_PASSWORD: "The email or password is incorrect. Check both fields, or request a password reset.",
  INVALID_PASSWORD: "The password is incorrect. Try again, or request a password reset.",
  EMAIL_NOT_VERIFIED: "Verify your email before you sign in. Use the verification link below to request a new email.",
  EMAIL_ALREADY_VERIFIED: "Your email is already verified. Return to sign in.",
  INVALID_EMAIL: "Enter a valid email address.",
  PASSWORD_TOO_SHORT: "Use a password with at least 12 characters.",
  PASSWORD_TOO_LONG: "Use a password with no more than 72 UTF-8 bytes. Non-ASCII characters can use multiple bytes.",
  INVALID_TOKEN: "This link is invalid or has expired. Request a new link.",
  TOKEN_EXPIRED: "This link has expired. Request a new link.",
  USER_ALREADY_EXISTS: "This account cannot be created. Try signing in or request a password reset.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "This account cannot be created. Try signing in or request a password reset.",
  SIGN_UP_DISABLED: "Registration is closed. Continue to use the existing WTS login for your existing WTS account.",
  EMAIL_MISMATCH: "Enter the email address for your current account.",
  PROVIDER_NOT_FOUND: "This sign-in provider is not available. Use your email and password.",
  invalid_profile: "Check your profile fields. Use a name of 1 to 200 characters, an HTTPS avatar URL, and a standard language tag.",
  invalid_signature: "This app request is invalid or has expired. Return to the app and start sign-in again."
};

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request(endpoint, body, method = "POST") {
  let response;
  try {
    response = await fetch(endpoint, {
      method,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new AccountRequestError("The account service could not be reached. Check your connection, then try again.", 0, "NETWORK_ERROR");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AccountRequestError("The account service returned an unreadable response. Try again.", response.status, "INVALID_RESPONSE");
  }
  if (!response.ok) {
    const code = record(data) && typeof data.code === "string" ? data.code
      : record(data) && record(data.error) && typeof data.error.code === "string" ? data.error.code
        : record(data) && typeof data.error === "string" ? data.error : "REQUEST_FAILED";
    const message = errors[code] ?? (response.status === 409
      ? "Your profile changed in another session. Load the current profile, then apply your changes again."
      : response.status === 429
        ? "Too many requests. Wait a minute, then try again."
        : response.status === 401
          ? "Your session has ended. Return to sign in."
          : response.status === 403
            ? "This action is not allowed. Verify your email or return to sign in."
            : response.status === 400
              ? "The account service did not accept these values. Check the fields, then try again."
              : "The account service could not complete this action. Try again.");
    throw new AccountRequestError(message, response.status, code);
  }
  return data;
}

function field(form, name) {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}

function continuation(form) {
  const query = field(form, "oauth_query");
  return query === "" ? {} : { oauth_query: query };
}

function callback(form, path, params = {}) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const query = field(form, "oauth_query");
  if (query !== "") url.searchParams.set("oauth_query", query);
  return url.href;
}

function redirectResult(data) {
  if (!record(data) || data.redirect !== true) return false;
  if (typeof data.url !== "string") throw new AccountRequestError("The account service did not return an app destination. Return to the app and try again.", 200, "INVALID_RESPONSE");
  const url = new URL(data.url, location.origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AccountRequestError("The account service returned an invalid app destination. Return to the app and try again.", 200, "INVALID_RESPONSE");
  location.assign(url.href);
  return true;
}

function message(form, kind, text) {
  const element = form.querySelector(kind === "error" ? "[data-form-error]" : "[data-form-status]");
  if (element instanceof HTMLElement) {
    element.textContent = text;
    element.hidden = text === "";
    if (kind === "error" && text !== "") element.focus();
  }
}

function profileFromResponse(data) {
  if (!record(data) || !record(data.profile)) throw new AccountRequestError("The account service returned an invalid profile. Reload this page.", 200, "INVALID_RESPONSE");
  const profile = data.profile;
  if (typeof profile.name !== "string" || (profile.preferredLanguage !== null && typeof profile.preferredLanguage !== "string") || (profile.avatarUrl !== null && typeof profile.avatarUrl !== "string") || !Number.isSafeInteger(profile.revision)) {
    throw new AccountRequestError("The account service returned an invalid profile. Reload this page.", 200, "INVALID_RESPONSE");
  }
  return profile;
}

function applyProfile(form, profile) {
  for (const [name, value] of Object.entries({ name: profile.name, avatarUrl: profile.avatarUrl ?? "", preferredLanguage: profile.preferredLanguage ?? "", expectedRevision: String(profile.revision) })) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.value = value;
  }
}

function newPassword(form, name) {
  const password = field(form, name);
  if (new TextEncoder().encode(password).length > 72) {
    throw new AccountRequestError(errors.PASSWORD_TOO_LONG, 400, "PASSWORD_TOO_LONG");
  }
  return password;
}

async function submit(form, submitter) {
  switch (form.dataset.accountAction) {
    case "sign-in": {
      const data = await request(form.action, { email: field(form, "email"), password: field(form, "password"), callbackURL: callback(form, "/account"), ...continuation(form) });
      if (!redirectResult(data)) location.assign(callback(form, "/account"));
      return;
    }
    case "social": {
      const data = await request(form.action, { provider: field(form, "provider"), callbackURL: callback(form, "/account"), errorCallbackURL: callback(form, "/sign-in"), ...continuation(form) });
      if (!redirectResult(data)) throw new AccountRequestError("The sign-in provider did not return a destination. Use your email and password, or try again.", 200, "INVALID_RESPONSE");
      return;
    }
    case "sign-up": {
      const email = field(form, "email");
      const data = await request(form.action, { name: field(form, "name"), email, password: newPassword(form, "password"), callbackURL: new URL("/verify-email?verified=1", location.origin).href, ...continuation(form) });
      if (!redirectResult(data)) location.assign(callback(form, "/verify-email", { email }));
      return;
    }
    case "recovery":
      await request(form.action, { email: field(form, "email"), redirectTo: new URL("/reset-password", location.origin).href });
      message(form, "status", "If this email has an account, you will receive a reset link. Check your inbox and spam folder.");
      return;
    case "reset-password": {
      await request(form.action, { token: field(form, "token"), newPassword: newPassword(form, "newPassword") });
      const input = form.elements.namedItem("newPassword");
      if (input instanceof HTMLInputElement) input.value = "";
      message(form, "status", "Your password has changed. Sign in with your new password. Other apps can retain their local sessions.");
      const link = document.querySelector("[data-reset-sign-in]");
      if (link instanceof HTMLElement) link.hidden = false;
      return;
    }
    case "verify-email":
      await request(form.action, { email: field(form, "email"), callbackURL: new URL("/verify-email?verified=1", location.origin).href });
      message(form, "status", "If this account needs verification, you will receive a new link. Check your inbox and spam folder.");
      return;
    case "consent": {
      const data = await request(form.action, { accept: submitter instanceof HTMLButtonElement && submitter.value === "true", ...continuation(form) });
      if (!redirectResult(data)) throw new AccountRequestError("The app request did not return a destination. Return to the app and try again.", 200, "INVALID_RESPONSE");
      return;
    }
    case "profile": {
      const language = field(form, "preferredLanguage");
      if (language !== "") {
        let canonical;
        try {
          canonical = new Intl.Locale(language).toString();
        } catch {
          throw new AccountRequestError("Enter a valid language tag, such as en, en-US, or mk.", 400, "invalid_profile");
        }
        if (canonical !== language) throw new AccountRequestError(`Use the standard language tag ${canonical}.`, 400, "invalid_profile");
      }
      const data = await request("/v1/me", { name: field(form, "name"), avatarUrl: field(form, "avatarUrl") || null, preferredLanguage: language || null, expectedRevision: Number(field(form, "expectedRevision")) }, "PATCH");
      applyProfile(form, profileFromResponse(data));
      message(form, "status", "Your shared profile is saved.");
      return;
    }
    case "sign-out":
      await request(form.action, {});
      location.assign("/sign-in?signed_out=1");
      return;
    default:
      throw new AccountRequestError("This account action is not available. Reload the page.", 0, "INVALID_ACTION");
  }
}

async function pending(form, action, text) {
  if (form.getAttribute("aria-busy") === "true") return;
  const buttons = [...form.querySelectorAll('button[type="submit"], [data-profile-reload]')];
  for (const button of buttons) if (button instanceof HTMLButtonElement) button.disabled = true;
  form.setAttribute("aria-busy", "true");
  message(form, "error", "");
  message(form, "status", text);
  try {
    await action();
  } catch (error) {
    message(form, "status", "");
    message(form, "error", error instanceof AccountRequestError ? error.message : "The account action could not complete. Try again.");
  } finally {
    form.removeAttribute("aria-busy");
    for (const button of buttons) if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

for (const button of document.querySelectorAll("[data-password-toggle]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  const input = document.getElementById(button.dataset.passwordToggle ?? "");
  if (!(input instanceof HTMLInputElement)) continue;
  button.hidden = false;
  button.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide password" : "Show password";
    button.setAttribute("aria-pressed", String(show));
  });
}

for (const form of document.querySelectorAll("form[data-account-action]")) {
  if (!(form instanceof HTMLFormElement)) continue;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void pending(form, () => submit(form, event.submitter), "Please wait. Your request is in progress.");
  });
  const reload = form.querySelector("[data-profile-reload]");
  if (reload instanceof HTMLButtonElement) {
    reload.hidden = false;
    reload.addEventListener("click", () => {
      void pending(form, async () => {
        applyProfile(form, profileFromResponse(await request("/v1/me", undefined, "GET")));
        message(form, "status", "The current profile is loaded. Apply your changes, then save.");
      }, "Please wait. The account service will load your current profile.");
    });
  }
}
