import { renderToString } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ cfp: undefined as unknown, authenticated: true, role: "admin" as string | undefined }));

vi.mock("solid-js", async (importOriginal) => ({ ...await importOriginal<typeof import("solid-js")>(), onSettled: (effect: () => void) => effect() }));
vi.mock("~/lib/async-resource", () => ({ createAsyncResource: () => [Object.assign(() => state.cfp, { loading: false })] }));
vi.mock("~/lib/cfp-utils", () => ({ fetchCfpConfig: vi.fn() }));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({
    isLoading: () => false,
    isAuthenticated: () => state.authenticated,
    get user() { return state.role ? { id: "user-1", role: state.role } : null; },
  }),
}));

import { Navbar } from "./Navbar";
import { links, markup } from "./route-markup-test-helper";


beforeEach(() => {
  state.cfp = { cfp_open: true };
  state.authenticated = true;
  vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const publicLinks = ["/cfp > Apply to speak", "/#about > About WhatTheStack", "https://2025.wts.sh > 2025 Edition", "https://2024.wts.sh > 2024 Edition"];

describe("Navbar links after mount", () => {
  it.each([
    ["admin", true, ["/admin Admin", "/reviewer Reviewer", "/mc MC Q&A", "/registrations Registrations", "/checkin Check-in"]],
    ["reviewer", true, ["/reviewer Reviewer"]],
    ["mc", true, ["/mc MC Q&A"]],
    ["checkin", true, []],
    ["user", true, []],
    [undefined, false, []],
  ])("shows the desktop links for role %s", (role, authenticated, roleLinks) => {
    state.role = role;
    state.authenticated = authenticated;
    expect(links(markup(renderToString(() => <Navbar />)))).toEqual(["/ WhatTheStack2 0 2 7", ...roleLinks, ...publicLinks]);
  });
});
