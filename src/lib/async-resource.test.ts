import { createRoot } from "solid-js";
import { describe, expect, it } from "vite-plus/test";
import { createAsyncResource } from "~/lib/async-resource";

describe("createAsyncResource", () => {
  it("does not leak Solid's pending sentinel when loading is read", () => {
    createRoot((dispose) => {
      const [resource] = createAsyncResource(async () => {
        await Promise.resolve();
        return "ready";
      });

      expect(() => resource.loading).not.toThrow();
      expect(resource.loading).toBe(true);
      dispose();
    });
  });

  it("returns its explicit loading value while async work is pending", () => {
    createRoot((dispose) => {
      const [resource] = createAsyncResource(async () => {
        await new Promise(() => undefined);
        return "ready";
      });

      expect(() => resource()).not.toThrow();
      expect(resource()).toBeUndefined();
      dispose();
    });
  });
});
