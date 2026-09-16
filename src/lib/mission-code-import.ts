import { parseMissionCode } from "~/lib/mission-code-format";

export const MAX_MISSION_CODE_IMPORT = 100;

/** Validate one supplied printed code per line. Never generates or rewrites codes. */
export function parseMissionCodeImport(text: string): string[] {
  if (typeof text !== "string" || text.length > 32_000) throw new Error("The code batch is too large.");
  const lines = text.split(/\r?\n/).map((raw, index) => ({ raw: raw.trim(), line: index + 1 })).filter(({ raw }) => raw);
  if (lines.length === 0) throw new Error("Enter at least one printed Mission code.");
  if (lines.length > MAX_MISSION_CODE_IMPORT) throw new Error("Register at most 100 printed Mission codes per batch.");
  const codes = new Set<string>();
  const prefixes = new Set<string>();
  for (const { raw, line } of lines) {
    const parsed = raw.length <= 160 ? parseMissionCode(raw) : undefined;
    if (!parsed) throw new Error(`Line ${line} is not a valid Mission code. No codes were registered.`);
    if (codes.has(parsed.normalizedCode)) throw new Error(`Line ${line} is a duplicate code. No codes were registered.`);
    if (prefixes.has(parsed.lookupPrefix)) throw new Error(`Line ${line} repeats a lookup prefix. No codes were registered.`);
    codes.add(parsed.normalizedCode);
    prefixes.add(parsed.lookupPrefix);
  }
  return lines.map(({ raw }) => raw);
}
