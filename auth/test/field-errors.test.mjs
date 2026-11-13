import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fieldMessage } from "../public/field-errors.mjs";

const info = (patch = {}) => ({ type: "text", minLength: -1, maxLength: -1, min: "", max: "", title: "", fallback: "Browser message.", ...patch });

test("field errors name the problem with the real limits", () => {
  assert.equal(fieldMessage({ valid: true, valueMissing: true }, info()), "");
  assert.equal(fieldMessage({ valueMissing: true }, info()), "Fill in this field.");
  assert.equal(fieldMessage({ typeMismatch: true }, info({ type: "email" })), "Enter a full email address, such as name@example.com.");
  assert.equal(fieldMessage({ typeMismatch: true }, info({ type: "url" })), "Enter a full web address that starts with https://.");
  assert.equal(fieldMessage({ tooShort: true }, info({ minLength: 12 })), "Use at least 12 characters.");
  assert.equal(fieldMessage({ tooLong: true }, info({ maxLength: 200 })), "Use 200 characters or fewer.");
  assert.equal(fieldMessage({ patternMismatch: true }, info()), "Browser message.");
});

test("every page loads the field error module", async () => {
  const pages = await readFile(new URL("../src/pages.ts", import.meta.url), "utf8");
  assert.match(pages, /<script type="module" src="\/assets\/field-errors\.mjs"><\/script>/);
});
