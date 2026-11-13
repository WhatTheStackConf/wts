// Shows one short error line under a field that fails native constraint validation, and keeps
// aria-invalid and aria-describedby in sync with it. The same module is copied into cfp and auth.

type Flag = "valueMissing" | "typeMismatch" | "tooShort" | "tooLong" | "rangeUnderflow" | "rangeOverflow" | "patternMismatch";

export type FieldValidity = Partial<Record<Flag | "valid", boolean>>;

export interface FieldInfo {
  type: string;
  minLength: number;
  maxLength: number;
  min: string;
  max: string;
  title: string;
  fallback: string;
}

const TYPE_MESSAGES: Record<string, string> = {
  email: "Enter a full email address, such as name@example.com.",
  url: "Enter a full web address that starts with https://.",
};

const MISSING_MESSAGES: Record<string, string> = {
  radio: "Choose one option.",
  checkbox: "Select this option.",
};

type Rule = readonly [Flag, (info: FieldInfo) => string];

const RULES: readonly Rule[] = [
  ["valueMissing", (info) => MISSING_MESSAGES[info.type] ?? "Fill in this field."],
  ["typeMismatch", (info) => TYPE_MESSAGES[info.type] ?? info.fallback],
  ["tooShort", (info) => `Use at least ${info.minLength} characters.`],
  ["tooLong", (info) => `Use ${info.maxLength} characters or fewer.`],
  ["rangeUnderflow", (info) => `Use ${info.min} or more.`],
  ["rangeOverflow", (info) => `Use ${info.max} or less.`],
  ["patternMismatch", (info) => info.title || info.fallback],
];

export function fieldMessage(validity: FieldValidity, info: FieldInfo): string {
  if (validity.valid) return "";
  const rule = RULES.find(([flag]) => validity[flag]);
  return rule ? rule[1](info) : info.fallback;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const SHOWN = "data-field-error-shown";
let errorCount = 0;

function isControl(target: EventTarget | null): target is Control {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function infoOf(control: Control): FieldInfo {
  const input = control instanceof HTMLInputElement ? control : undefined;
  return {
    type: control.type,
    minLength: input?.minLength ?? -1,
    maxLength: input?.maxLength ?? -1,
    min: input?.min ?? "",
    max: input?.max ?? "",
    title: control.title,
    fallback: control.validationMessage,
  };
}

function groupOf(control: Control): Control[] {
  if (!(control instanceof HTMLInputElement) || control.type !== "radio" || !control.form || !control.name) return [control];
  return [...control.form.querySelectorAll<HTMLInputElement>("input[type='radio']")].filter((radio) => radio.name === control.name);
}

// A radio group gets one error at the end of its fieldset. A wrapping label gets the error after
// it, to keep the error out of the accessible name. Other controls get it directly below them.
function placeError(control: Control, error: HTMLElement): void {
  const fieldset = control.type === "radio" ? control.closest("fieldset") : null;
  const label = control.closest("label");
  if (fieldset) fieldset.append(error);
  else if (label) label.after(error);
  else control.after(error);
}

function errorFor(control: Control, create: boolean): HTMLElement | undefined {
  const id = control.getAttribute("data-field-error-id");
  const existing = id ? document.getElementById(id) : null;
  if (existing || !create) return existing ?? undefined;
  const error = document.createElement("span");
  error.className = "field-error";
  error.id = `field-error-${++errorCount}`;
  error.hidden = true;
  placeError(control, error);
  for (const member of groupOf(control)) member.setAttribute("data-field-error-id", error.id);
  return error;
}

function describe(control: Control, id: string, on: boolean): void {
  const tokens = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((token) => token && token !== id);
  if (on) tokens.push(id);
  if (tokens.length > 0) control.setAttribute("aria-describedby", tokens.join(" "));
  else control.removeAttribute("aria-describedby");
}

function show(control: Control): void {
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

function clear(control: Control): void {
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

function userInvalid(control: Control): boolean {
  try {
    return control.matches(":user-invalid");
  } catch {
    return control.value !== "";
  }
}

export function watchFieldErrors(root: Document | HTMLElement = document): () => void {
  let focusTimer: number | undefined;

  const onInvalid = (event: Event) => {
    const control = event.target;
    if (!isControl(control)) return;
    event.preventDefault();
    show(control);
    if (focusTimer !== undefined) return;
    control.focus();
    focusTimer = window.setTimeout(() => { focusTimer = undefined; }, 0);
  };

  const onLeave = (event: Event) => {
    const control = event.target;
    if (!isControl(control) || control.disabled) return;
    if (control.validity.valid) clear(control);
    else if (control.hasAttribute(SHOWN) || userInvalid(control)) show(control);
  };

  const onEdit = (event: Event) => {
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
    if (focusTimer !== undefined) window.clearTimeout(focusTimer);
  };
}
