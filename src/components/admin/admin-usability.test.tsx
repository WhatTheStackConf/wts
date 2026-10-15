import type { ParentProps } from "solid-js";
import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ authorized: true, resource: undefined as unknown, loading: false }));

vi.mock("~/layouts/Layout", () => ({ Layout: (props: ParentProps) => <main>{props.children}</main> }));
vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/lib/route-guards", () => ({ useRequireAdmin: () => ({ authorized: () => state.authorized }) }));
vi.mock("~/lib/async-resource", () => ({
  createAsyncResource: () => [Object.assign(() => state.resource, { loading: state.loading }), { mutate: vi.fn(), refetch: vi.fn() }],
}));

import { AdminDashboard } from "~/routes/admin/index";

const text = (html: string) => html.replace(/<!--.*?-->/g, "");

beforeEach(() => {
  state.authorized = true;
  state.resource = undefined;
  state.loading = false;
});

describe("admin workspace simplicity", () => {
  it("keeps every original dashboard destination and adds the admin-authorized MC workspace", () => {
    const html = text(renderToString(() => <AdminDashboard />));
    const expected = ["/admin/checkin", "/admin/users", "/admin/proposals", "/admin/agenda", "/admin/gamification", "/reviewer/weights", "/reviewer/leaderboard", "/admin/speakers", "/admin/sessions", "/admin/partners", "/admin/tickets", "/admin/mcp", "/mc"];
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(links.sort()).toEqual(expected.sort());
  });

  it("keeps workspace links and CFP controls behind the existing admin guard", () => {
    state.authorized = false;
    const html = renderToString(() => <AdminDashboard />);
    expect(html).not.toContain('aria-label="Admin workspaces"');
    expect(html).not.toContain("Call for papers");
  });

});