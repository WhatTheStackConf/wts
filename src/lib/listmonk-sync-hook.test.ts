import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

const hookSource = readFileSync(new URL("../../pocketbase/pb_hooks/listmonk_sync.pb.js", import.meta.url), "utf8");

type Response = { statusCode: number; raw: string };

function runListmonkSync(env: Record<string, string>, send?: (request: unknown) => Response) {
  const calls = { registered: [] as unknown[], logs: [] as unknown[][], http: [] as unknown[], next: 0 };
  let hook: ((event: unknown) => void) | undefined;
  const context = createContext({
    onRecordAfterCreateSuccess: (callback: (event: unknown) => void, ...collections: string[]) => {
      calls.registered.push(collections);
      hook = callback;
    },
    $os: { getenv: (name: string) => env[name] ?? "" },
    $security: { base64Encode: (value: string) => `b64(${value})` },
    $http: {
      send: (request: unknown) => {
        calls.http.push(request);
        if (!send) throw new Error("unexpected HTTP request");
        return send(request);
      },
    },
  });
  runInContext(hookSource, context);
  const logger = {
    warn: (...args: unknown[]) => calls.logs.push(["warn", ...args]),
    error: (...args: unknown[]) => calls.logs.push(["error", ...args.map(errorMessage)]),
  };
  hook?.({
    record: { email: () => "ann@example.test", get: (key: string) => (key === "name" ? "Ann" : undefined) },
    app: { logger: () => logger },
    next: () => { calls.next += 1; },
  });
  return calls;
}

const errorMessage = (value: unknown) =>
  value && typeof value === "object" && "message" in value ? (value as { message: unknown }).message : value;

const credentials = { LISTMONK_USERNAME: "sync", LISTMONK_API_TOKEN: "token" };

describe("listmonk sync hook", () => {
  it("skips the sync without credentials and still continues the chain", () => {
    const calls = runListmonkSync({ LISTMONK_USERNAME: "sync" });
    expect(calls.registered).toEqual([["users"]]);
    expect(calls.logs).toEqual([["warn", "Listmonk sync skipped: set LISTMONK_USERNAME and LISTMONK_API_TOKEN (or LISTMONK_PASSWORD)"]]);
    expect(calls.http).toEqual([]);
    expect(calls.next).toBe(1);
  });

  it("subscribes the new user to the default list on the default server", () => {
    const calls = runListmonkSync(credentials, () => ({ statusCode: 200, raw: "{}" }));
    expect(calls.http).toEqual([{
      url: "https://listmonk.wts.sh/api/subscribers",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Basic b64(sync:token)" },
      body: JSON.stringify({ email: "ann@example.test", name: "Ann", status: "enabled", lists: [2], preconfirm_subscriptions: true }),
    }]);
    expect(calls.logs).toEqual([]);
    expect(calls.next).toBe(1);
  });

  it("uses the password fallback, trims the URL, and parses the list id", () => {
    const calls = runListmonkSync(
      { LISTMONK_USERNAME: "sync", LISTMONK_PASSWORD: "pw", LISTMONK_URL: "https://lists.example///", LISTMONK_LIST_ID: "7x" },
      () => ({ statusCode: 409, raw: "exists" }),
    );
    const request = calls.http[0] as { url: string; headers: Record<string, string>; body: string };
    expect(request.url).toBe("https://lists.example/api/subscribers");
    expect(request.headers.Authorization).toBe("Basic b64(sync:pw)");
    expect(JSON.parse(request.body).lists).toEqual([7]);
    expect(calls.logs).toEqual([]);
  });

  it("keeps the default list for a non-numeric list id", () => {
    const calls = runListmonkSync({ ...credentials, LISTMONK_LIST_ID: "abc" }, () => ({ statusCode: 201, raw: "" }));
    expect(JSON.parse((calls.http[0] as { body: string }).body).lists).toEqual([2]);
  });

  it("logs a failed response and a thrown request without blocking the chain", () => {
    const failed = runListmonkSync(credentials, () => ({ statusCode: 500, raw: "boom" }));
    expect(failed.logs).toEqual([["error", "Failed to sync user to listmonk", "email", "ann@example.test", "status", 500, "body", "boom"]]);
    expect(failed.next).toBe(1);
    const thrown = runListmonkSync(credentials, () => { throw new Error("offline"); });
    expect(thrown.logs).toEqual([["error", "Listmonk sync error", "error", "offline"]]);
    expect(thrown.next).toBe(1);
  });
});
