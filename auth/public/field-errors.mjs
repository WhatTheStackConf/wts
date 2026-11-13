// Shows one short error line under a field that fails native constraint validation, and keeps
// aria-invalid and aria-describedby in sync with it. Built from site/src/lib/field-errors.ts with
// esbuild (format esm). Change the copies together.
const TYPE_MESSAGES = {
  email: "Enter a full email address, such as name@example.com.",
  url: "Enter a full web address that starts with https://."
};
const MISSING_MESSAGES = {
  radio: "Choose one option.",
  checkbox: "Select this option."
};
const RULES = [
  ["valueMissing", (info) => MISSING_MESSAGES[info.type] ?? "Fill in this field."],
  ["typeMismatch", (info) => TYPE_MESSAGES[info.type] ?? info.fallback],
  ["tooShort", (info) => `Use at least ${info.minLength} characters.`],
  ["tooLong", (info) => `Use ${info.maxLength} characters or fewer.`],
  ["rangeUnderflow", (info) => `Use ${info.min} or more.`],
  ["rangeOverflow", (info) => `Use ${info.max} or less.`],
  ["patternMismatch", (info) => info.title || info.fallback]
];
function fieldMessage(validity, info) {
  if (validity.valid) return "";
  const rule = RULES.find(([flag]) => validity[flag]);
  return rule ? rule[1](info) : info.fallback;
}
const SHOWN = "data-field-error-shown";
let errorCount = 0;
function isControl(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}
function infoOf(control) {
  const input = control instanceof HTMLInputElement ? control : void 0;
  return {
    type: control.type,
    minLength: input?.minLength ?? -1,
    maxLength: input?.maxLength ?? -1,
    min: input?.min ?? "",
    max: input?.max ?? "",
    title: control.title,
    fallback: control.validationMessage
  };
}
function groupOf(control) {
  if (!(control instanceof HTMLInputElement) || control.type !== "radio" || !control.form || !control.name) return [control];
  return [...control.form.querySelectorAll("input[type='radio']")].filter((radio) => radio.name === control.name);
}
function placeError(control, error) {
  const fieldset = control.type === "radio" ? control.closest("fieldset") : null;
  const label = control.closest("label");
  if (fieldset) fieldset.append(error);
  else if (label) label.after(error);
  else control.after(error);
}
function errorFor(control, create) {
  const id = control.getAttribute("data-field-error-id");
  const existing = id ? document.getElementById(id) : null;
  if (existing || !create) return existing ?? void 0;
  const error = document.createElement("span");
  error.className = "field-error";
  error.id = `field-error-${++errorCount}`;
  error.hidden = true;
  placeError(control, error);
  for (const member of groupOf(control)) member.setAttribute("data-field-error-id", error.id);
  return error;
}
function describe(control, id, on) {
  const tokens = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((token) => token && token !== id);
  if (on) tokens.push(id);
  if (tokens.length > 0) control.setAttribute("aria-describedby", tokens.join(" "));
  else control.removeAttribute("aria-describedby");
}
function show(control) {
  const error = errorFor(control, true);
  if (!error) return;
  error.textContent = fieldMessage(control.validity, infoOf(control));
  error.hidden = false;
  for (const member of groupOf(control)) {
    member.setAttribute("aria-invalid", "true");
    member.setAttribute(SHOWN, "");
    describe(member, error.id, true);
  }
}
function clear(control) {
  const error = errorFor(control, false);
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }
  for (const member of groupOf(control)) {
    member.removeAttribute("aria-invalid");
    member.removeAttribute(SHOWN);
    if (error) describe(member, error.id, false);
  }
}
function userInvalid(control) {
  try {
    return control.matches(":user-invalid");
  } catch {
    return control.value !== "";
  }
}
function watchFieldErrors(root = document) {
  let focusTimer;
  const onInvalid = (event) => {
    const control = event.target;
    if (!isControl(control)) return;
    event.preventDefault();
    show(control);
    if (focusTimer !== void 0) return;
    control.focus();
    focusTimer = window.setTimeout(() => {
      focusTimer = void 0;
    }, 0);
  };
  const onLeave = (event) => {
    const control = event.target;
    if (!isControl(control) || control.disabled) return;
    if (control.validity.valid) clear(control);
    else if (control.hasAttribute(SHOWN) || userInvalid(control)) show(control);
  };
  const onEdit = (event) => {
    const control = event.target;
    if (!isControl(control) || !control.hasAttribute(SHOWN)) return;
    if (control.validity.valid) clear(control);
    else show(control);
  };
  root.addEventListener("invalid", onInvalid, true);
  root.addEventListener("focusout", onLeave, true);
  root.addEventListener("input", onEdit, true);
  root.addEventListener("change", onEdit, true);
  return () => {
    root.removeEventListener("invalid", onInvalid, true);
    root.removeEventListener("focusout", onLeave, true);
    root.removeEventListener("input", onEdit, true);
    root.removeEventListener("change", onEdit, true);
    if (focusTimer !== void 0) window.clearTimeout(focusTimer);
  };
}
export {
  fieldMessage,
  watchFieldErrors
};

if (typeof document !== "undefined") watchFieldErrors();
