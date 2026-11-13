import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldMessage, type FieldInfo } from "./field-errors.ts";

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
    assert.equal(fieldMessage({ valid: true, valueMissing: true }, info()), "");
  });

  it("names the missing value by control type", () => {
    assert.equal(fieldMessage({ valueMissing: true }, info()), "Fill in this field.");
    assert.equal(fieldMessage({ valueMissing: true }, info({ type: "radio" })), "Choose one option.");
    assert.equal(fieldMessage({ valueMissing: true }, info({ type: "checkbox" })), "Select this option.");
  });

  it("explains email and URL formats", () => {
    assert.equal(fieldMessage({ typeMismatch: true }, info({ type: "email" })), "Enter a full email address, such as name@example.com.");
    assert.equal(fieldMessage({ typeMismatch: true }, info({ type: "url" })), "Enter a full web address that starts with https://.");
  });

  it("states length limits with the real numbers", () => {
    assert.equal(fieldMessage({ tooShort: true }, info({ minLength: 12 })), "Use at least 12 characters.");
    assert.equal(fieldMessage({ tooLong: true }, info({ maxLength: 200 })), "Use 200 characters or fewer.");
  });

  it("prefers the missing value over a format problem", () => {
    assert.equal(fieldMessage({ valueMissing: true, typeMismatch: true }, info({ type: "email" })), "Fill in this field.");
  });

  it("falls back to the field title, then to the browser message", () => {
    assert.equal(fieldMessage({ patternMismatch: true }, info({ title: "Use a language tag such as en." })), "Use a language tag such as en.");
    assert.equal(fieldMessage({ patternMismatch: true }, info()), "Browser message.");
    assert.equal(fieldMessage({ stepMismatch: true } as never, info()), "Browser message.");
  });
});
