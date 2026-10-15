import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import LoginMenu from "~/components/LoginMenu";

const auth = vi.hoisted(() => ({
  record: { name: "Account Test", email: "account@example.test", role: "user" },
  isAuthenticated: vi.fn(() => true),
  isLoading: vi.fn(() => false),
  logout: vi.fn(async () => {}),
}));

vi.mock("~/lib/auth-context", () => ({ useAuth: () => auth }));

beforeEach(() => {
  auth.isAuthenticated.mockReturnValue(true);
  auth.isLoading.mockReturnValue(false);
  auth.record.role = "user";
});

describe("account menu", () => {
  it("keeps account actions available when authenticated", () => {
    const html = renderToString(() => <LoginMenu />);
    expect(html).toContain('href="/user/profile"');
    expect(html).toContain('href="/user/profile#gamification"');
    expect(html).not.toContain('href="/login"');
  });

  it("shows only the login action when signed out", () => {
    auth.isAuthenticated.mockReturnValue(false);
    const html = renderToString(() => <LoginMenu />);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('id="user-menu"');
    expect(html).not.toContain("account@example.test");
  });

  it("does not flash login while authentication is loading", () => {
    auth.isAuthenticated.mockReturnValue(false);
    auth.isLoading.mockReturnValue(true);
    const html = renderToString(() => <LoginMenu />);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('id="user-menu"');
  });
});
