import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

const hookSource = readFileSync(new URL("../../pocketbase/pb_hooks/daily_report.pb.js", import.meta.url), "utf8");
const fixedNow = Date.UTC(2026, 9, 15, 8, 0, 0);

type Fixture = {
  available?: boolean;
  env?: Record<string, string>;
  newUsers?: Array<{ email: string; name?: string }>;
  newSubmissions?: Array<{ session_title?: string }>;
  totalUsers?: number;
  totalSubmissions?: number;
  http?: (request: { url: string; method: string; headers: Record<string, string>; body?: string }) => { raw: string };
};

function runDailyReport(fixture: Fixture = {}) {
  const calls = { filters: [] as unknown[][], logs: [] as unknown[][], http: [] as unknown[], sent: [] as unknown[], templates: [] as unknown[][] };
  const record = (fields: Record<string, unknown>) => ({ email: () => fields.email, get: (key: string) => fields[key] });
  const lists: Record<string, unknown[]> = {
    "users:created >= {:since}": (fixture.newUsers ?? []).map(record),
    "cfp_submissions:created >= {:since}": (fixture.newSubmissions ?? []).map(record),
    "users:": Array.from({ length: fixture.totalUsers ?? 0 }, () => record({})),
    "cfp_submissions:": Array.from({ length: fixture.totalSubmissions ?? 0 }, () => record({})),
  };
  const app = {
    findRecordsByFilter: (...args: unknown[]) => {
      calls.filters.push(args);
      return lists[`${args[0]}:${args[1]}`];
    },
    logger: () => ({
      error: (...args: unknown[]) => calls.logs.push(["error", ...args.map(errorMessage)]),
      info: (...args: unknown[]) => calls.logs.push(["info", ...args]),
    }),
    settings: () => ({ meta: { senderAddress: "noreply@wts.example", senderName: "WTS" } }),
    newMailClient: () => ({ send: (message: unknown) => calls.sent.push(message) }),
  };
  let job: (() => void) | undefined;
  const context = createContext({
    cronAdd: (name: string, schedule: string, callback: () => void) => {
      calls.filters.push(["cronAdd", name, schedule]);
      job = callback;
    },
    __hooks: "/hooks",
    require: (path: string) => {
      calls.filters.push(["require", path]);
      return { isAvailable: (target: unknown, capability: string) => target === app && capability === "cfp" && fixture.available !== false };
    },
    $app: app,
    $os: { getenv: (name: string) => fixture.env?.[name] ?? "" },
    $http: {
      send: (request: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
        calls.http.push(request);
        if (!fixture.http) throw new Error("unexpected HTTP request");
        return fixture.http(request);
      },
    },
    wtsEmailTemplate: (target: unknown, title: string, content: string) => {
      calls.templates.push([target === app, title]);
      return `<template>${content}</template>`;
    },
    MailerMessage: class {
      constructor(options: unknown) {
        Object.assign(this, options);
      }
    },
  });
  runInContext(`(() => { const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(${fixedNow}); else super(...a); } static now() { return ${fixedNow}; } }; })();`, context);
  runInContext(hookSource, context);
  job?.();
  return calls;
}

const errorMessage = (value: unknown) =>
  value && typeof value === "object" && "message" in value ? (value as { message: unknown }).message : value;
const normalizeSpace = (value: string) => value.replace(/\s+/g, " ").trim();

describe("daily report cron hook", () => {
  it("registers the 08:00 job and stops when the CFP report is unavailable", () => {
    const calls = runDailyReport({ available: false });
    expect(calls.filters).toEqual([["cronAdd", "daily-report", "0 8 * * *"], ["require", "/hooks/capability-availability.js"]]);
    expect(calls.logs).toEqual([["error", "Failed to send daily report", "error", "CFP report unavailable."]]);
    expect(calls.sent).toEqual([]);
  });

  it("mails the activity summary to the default recipient without ticket credentials", () => {
    const calls = runDailyReport({
      newUsers: [{ email: "ann@example.test", name: "Ann" }, { email: "bob@example.test" }],
      totalUsers: 5,
      totalSubmissions: 2,
    });
    const since = { since: "2026-10-14 08:00:00.000Z" };
    expect(calls.filters.slice(2)).toEqual([
      ["users", "created >= {:since}", "-created", 0, 0, since],
      ["cfp_submissions", "created >= {:since}", "-created", 0, 0, since],
      ["users", "", "", 0, 0],
      ["cfp_submissions", "", "", 0, 0],
    ]);
    expect(calls.http).toEqual([]);
    expect(calls.templates).toEqual([[true, "WTS Daily Report"]]);
    expect(calls.sent).toHaveLength(1);
    const message = calls.sent[0] as { from: unknown; to: unknown; subject: string; html: string };
    expect(message.from).toEqual({ address: "noreply@wts.example", name: "WTS" });
    expect(message.to).toEqual([{ address: "darko@wts.rocks" }]);
    expect(message.subject).toBe("WTS Daily Report - 2026-10-15");
    expect(normalizeSpace(message.html)).toBe(normalizeSpace(`<template>
      <h2 style="margin: 0 0 15px 0; color: #333333;">Daily Report - 2026-10-15</h2>
      <h3 style="color: #333333; margin: 20px 0 10px 0;">New Users (last 24h): 2</h3>
      <ul><li>ann@example.test (Ann)</li><li>bob@example.test (no name)</li></ul>
      <h3 style="color: #333333; margin: 20px 0 10px 0;">New CfP Submissions (last 24h): 0</h3>
      <p>None</p>
      <h3 style="color: #333333; margin: 20px 0 10px 0;">Ticket Sales (all time)</h3>
      <p>Could not fetch ticket data</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 13px; color: #888888;"> Totals: 5 users, 2 submissions </p>
    </template>`));
    expect(calls.logs).toEqual([["info", "Daily report sent", "users", 2, "submissions", 0]]);
  });

  it("adds Hi.Events ticket totals and splits configured recipients", () => {
    const env = {
      HIEVENTS_API_URL: "https://tickets.example",
      HIEVENTS_EVENT_ID: "42",
      HIEVENTS_EMAIL: "ops@example.test",
      HIEVENTS_PASSWORD: "pw",
      HIEVENTS_ACCOUNT_ID: "7",
      CFP_DAILY_REPORT_RECIPIENT: " one@example.test, ,two@example.test ",
    };
    const calls = runDailyReport({
      env,
      newSubmissions: [{ session_title: "Edge Rendering" }, {}],
      http: (request) => request.url.endsWith("/api/auth/login")
        ? { raw: JSON.stringify({ token: "jwt" }) }
        : { raw: JSON.stringify({ data: { product_categories: [{ products: [{ title: "Early", quantity_sold: 3 }, { title: "Late" }] }] } }) },
    });
    expect(calls.http).toEqual([
      {
        url: "https://tickets.example/api/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: "ops@example.test", password: "pw", account_id: "7" }),
      },
      {
        url: "https://tickets.example/api/events/42/",
        method: "GET",
        headers: { Accept: "application/json", Authorization: "Bearer jwt" },
      },
    ]);
    const message = calls.sent[0] as { to: unknown; html: string };
    expect(message.to).toEqual([{ address: "one@example.test" }, { address: "two@example.test" }]);
    expect(message.html).toContain("<ul><li>Edge Rendering</li><li>Untitled</li></ul>");
    expect(message.html).toContain("<p>Early: 3 sold<br>Late: 0 sold<br><strong>Total: 3 tickets</strong></p>");
    expect(message.html).toContain("<p>None</p>");
    expect(calls.logs).toEqual([["info", "Daily report sent", "users", 0, "submissions", 2]]);
  });

  it("keeps sending the report when Hi.Events fails", () => {
    const calls = runDailyReport({
      env: { HIEVENTS_API_URL: "https://tickets.example", HIEVENTS_EVENT_ID: "42", HIEVENTS_EMAIL: "ops@example.test", HIEVENTS_PASSWORD: "pw" },
      http: () => ({ raw: "not json" }),
    });
    expect(calls.http).toHaveLength(1);
    expect(calls.logs[0]?.slice(0, 3)).toEqual(["error", "Daily report: failed to fetch tickets", "error"]);
    expect((calls.sent[0] as { html: string }).html).toContain("<p>Could not fetch ticket data</p>");
    expect(calls.logs[1]).toEqual(["info", "Daily report sent", "users", 0, "submissions", 0]);
  });

  it("skips Hi.Events when any required setting is missing", () => {
    const calls = runDailyReport({ env: { HIEVENTS_API_URL: "https://tickets.example", HIEVENTS_EVENT_ID: "42", HIEVENTS_EMAIL: "ops@example.test" } });
    expect(calls.http).toEqual([]);
    expect(calls.sent).toHaveLength(1);
  });
});
