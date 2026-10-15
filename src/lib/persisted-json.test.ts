import { describe, expect, it } from "vite-plus/test";
import { samePersistedJson } from "~/lib/persisted-json";

describe("persisted JSON request identity", () => {
  it("survives PocketBase object-key ordering and omitted undefined fields", () => {
    expect(samePersistedJson({ z: 1, nested: { b: 2, a: 3 }, optional: undefined }, { nested: { a: 3, b: 2 }, z: 1 })).toBe(true);
  });
  it("still rejects changed values, array order and null-versus-absent fields", () => {
    expect(samePersistedJson({ values: [1, 2] }, { values: [2, 1] })).toBe(false);
    expect(samePersistedJson({ value: 1 }, { value: "1" })).toBe(false);
    expect(samePersistedJson({ value: null }, {})).toBe(false);
  });
});
