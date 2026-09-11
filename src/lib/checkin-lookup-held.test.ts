import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { LOOKUP_HOLD_KEY, persistLookupHold, readLookupHold, releaseLookupHold } from "~/lib/checkin-lookup-held";
const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
function storage() {
 const entries = new Map<string, string>();
 vi.stubGlobal("window", { localStorage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } } });
 return entries;
}
afterEach(() => vi.unstubAllGlobals());
describe("opaque lookup handoff", () => {
 it("stores only the UUID, restores it, and releases only the exact target", () => {
  const entries = storage(); persistLookupHold(first);
  expect([...entries]).toEqual([[LOOKUP_HOLD_KEY, first]]);
  expect(readLookupHold()).toBe(first);
  releaseLookupHold(second); expect(readLookupHold()).toBe(first);
  releaseLookupHold(first); expect(readLookupHold()).toBeUndefined();
 });
 it("refuses to replace unknown work but permits an explicitly linked continuation", () => {
  storage(); persistLookupHold(first);
  expect(() => persistLookupHold(second)).toThrow("Another lookup operation");
  expect(readLookupHold()).toBe(first);
  persistLookupHold(second, first); expect(readLookupHold()).toBe(second);
 });
 it("fails closed when storage cannot retain the reference", () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} } });
  expect(() => persistLookupHold(first)).toThrow("Could not retain");
 });
 it("rejects malformed stored values and never normalizes them", () => {
  const entries = storage(); entries.set(LOOKUP_HOLD_KEY, "not-an-operation");
  expect(() => readLookupHold()).toThrow("Invalid held operation");
  expect(() => persistLookupHold(first)).toThrow("Invalid held operation");
 });
 it("rejects PII instead of placing it in browser storage", () => {
  const entries = storage();
  expect(() => persistLookupHold("person@example.test")).toThrow("Invalid operation");
  expect(entries.size).toBe(0);
 });
});
