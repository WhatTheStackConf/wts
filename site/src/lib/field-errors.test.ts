import { describe, expect, it } from "vite-plus/test";
import { fieldMessage, type FieldInfo } from "~/lib/field-errors";

const info = (patch: Partial<FieldInfo> = {}): FieldInfo => ({
  type: "text",
  minLength: -1,
  maxLength: -1,
  min: "",
  max: "",
  title: "",
  fallback: "Browser message.",
  ...patch,
});

describe("fieldMessage", () => {
  it("returns no message for a valid field", () => {
    expect(fieldMessage({ valid: true, valueMissing: true }, info())).toBe("");
  });

  it("names the missing value by control type", () => {
    expect(fieldMessage({ valueMissing: true }, info())).toBe("Fill in this field.");
    expect(fieldMessage({ valueMissing: true }, info({ type: "radio" }))).toBe("Choose one option.");
    expect(fieldMessage({ valueMissing: true }, info({ type: "checkbox" }))).toBe("Select this option.");
  });

  it("explains email and URL formats", () => {
    expect(fieldMessage({ typeMismatch: true }, info({ type: "email" }))).toBe("Enter a full email address, such as name@example.com.");
    expect(fieldMessage({ typeMismatch: true }, info({ type: "url" }))).toBe("Enter a full web address that starts with https://.");
  });

  it("states length limits with the real numbers", () => {
    expect(fieldMessage({ tooShort: true }, info({ minLength: 12 }))).toBe("Use at least 12 characters.");
    expect(fieldMessage({ tooLong: true }, info({ maxLength: 200 }))).toBe("Use 200 characters or fewer.");
  });

  it("prefers the missing value over a format problem", () => {
    expect(fieldMessage({ valueMissing: true, typeMismatch: true }, info({ type: "email" }))).toBe("Fill in this field.");
  });

  it("falls back to the field title, then to the browser message", () => {
    expect(fieldMessage({ patternMismatch: true }, info({ title: "Use a language tag such as en." }))).toBe("Use a language tag such as en.");
    expect(fieldMessage({ patternMismatch: true }, info())).toBe("Browser message.");
    expect(fieldMessage({ stepMismatch: true } as never, info())).toBe("Browser message.");
  });
});
