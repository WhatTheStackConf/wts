import { describe, expect, it } from "vite-plus/test";
import { createMissionCodeGeneration } from "~/lib/mission-code-crypto";
import { parseMissionCodeImport } from "~/lib/mission-code-import";

const code = () => createMissionCodeGeneration("disposable-import-test-pepper").rawCode;

describe("printed Mission code import", () => {
  it("preserves the supplied code identities without generating replacements", () => {
    const first = code();
    const second = code().toLowerCase();
    expect(parseMissionCodeImport(`  ${first}\r\n\n${second}  `)).toEqual([first, second]);
  });

  it("rejects empty, malformed, or oversized batches without echoing bearer input", () => {
    expect(() => parseMissionCodeImport("\n ")).toThrow("at least one");
    expect(() => parseMissionCodeImport("private-not-a-code")).toThrow("Line 1");
    expect(() => parseMissionCodeImport("private-not-a-code")).not.toThrow("private-not-a-code");
    expect(() => parseMissionCodeImport(Array.from({ length: 101 }, code).join("\n"))).toThrow("100");
    expect(() => parseMissionCodeImport("x".repeat(32_001))).toThrow("too large");
  });

  it("rejects equivalent codes and lookup-prefix collisions within a batch", () => {
    const first = code();
    expect(() => parseMissionCodeImport(`${first}\n${first.toLowerCase()}`)).toThrow("duplicate");
    const samePrefix = `${first.slice(0, 15)}${code().slice(15)}`;
    expect(() => parseMissionCodeImport(`${first}\n${samePrefix}`)).toThrow("prefix");
  });
});
