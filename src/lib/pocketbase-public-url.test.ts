import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getPocketBasePublicBaseUrl } from "~/lib/pocketbase-public-url";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("explicit local PocketBase endpoints", () => {
  it.each([
    ["http://127.0.0.1:18090", "http://127.0.0.1:18090"],
    ["http://localhost:18090", "http://127.0.0.1:18090"],
    ["https://production.example.test", "http://127.0.0.1:8090"],
  ])("resolves %s without redirecting a configured local port", (configured, expected) => {
    vi.stubEnv("PUBLIC_POCKETBASE_URL", configured);
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1", protocol: "http:" } });
    expect(getPocketBasePublicBaseUrl()).toBe(expected);
  });
});
