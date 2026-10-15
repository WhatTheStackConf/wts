import { isDeepStrictEqual } from "node:util";

/** Compare JSON persistence semantics, not JavaScript object insertion order. */
export function samePersistedJson(left: unknown, right: unknown): boolean {
  try {
    return isDeepStrictEqual(JSON.parse(JSON.stringify(left)), JSON.parse(JSON.stringify(right)));
  } catch {
    return false;
  }
}
