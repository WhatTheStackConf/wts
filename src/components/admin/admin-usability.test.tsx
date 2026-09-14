import { readFileSync } from "node:fs";
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
import { AdminPageShell } from "~/components/admin/AdminPageShell";
import AdminAgendaHub from "~/components/admin/AdminAgendaHub";
import AdminMcpTokensHub from "~/components/admin/AdminMcpTokensHub";
import AdminGamificationHub from "~/components/admin/gamification/AdminGamificationHub";
import AdminCommunityPartnerMissions from "~/components/admin/gamification/AdminCommunityPartnerMissions";
import AdminHiEventsReconciliation from "~/components/admin/gamification/AdminHiEventsReconciliation";
import AdminGamificationSupport from "~/components/admin/gamification/AdminGamificationSupport";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
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
    expect(html).toContain('aria-label="Admin workspaces"');
    expect(html).not.toContain("SYSTEM ACCESS LEVEL");
    expect(html).not.toContain("Back to dashboard");
    expect(html).not.toContain('href="/admin"');
  });

  it("keeps workspace links and CFP controls behind the existing admin guard", () => {
    state.authorized = false;
    const html = renderToString(() => <AdminDashboard />);
    expect(html).not.toContain('aria-label="Admin workspaces"');
    expect(html).not.toContain("Call for papers");
  });

  it("distinguishes unavailable CFP status from closed submissions", () => {
    const unavailable = text(renderToString(() => <AdminDashboard />));
    expect(unavailable).toContain("CFP status unavailable");
    expect(unavailable).toMatch(/<button[^>]*disabled/);
    state.loading = true;
    expect(text(renderToString(() => <AdminDashboard />))).toContain("Loading CFP status");
    state.loading = false;
    state.resource = { cfp_open: true, cfp_deadline: null };
    const opened = text(renderToString(() => <AdminDashboard />));
    expect(opened).toContain("Close CFP");
    expect(opened).toContain("Deadline: Not set");
    expect(opened).not.toMatch(/<button[^>]*disabled/);
    state.resource = { cfp_open: false, cfp_deadline: null };
    expect(text(renderToString(() => <AdminDashboard />))).toContain("Open CFP");
  });

  it("keeps save errors as assertive visible alerts without requiring a subtitle", () => {
    const html = renderToString(() => <AdminPageShell title="Sessions" layoutTitle="Sessions" layoutDescription="Sessions" toast={{ type: "error", text: "Could not save session." }}>Records</AdminPageShell>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Could not save session.");
    expect(html).toContain("Dashboard");
  });

  it("collapses draft editors without removing fields or lifecycle warnings", () => {
    const html = text(renderToString(() => <AdminGamificationHub />));
    expect(html.match(/<details\b/g)).toHaveLength(3);
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    for (const name of ["Achievement draft", "Mission draft", "Activity draft"]) expect(html).toContain(name);
    expect(html).toContain('id="gam-lifecycle-reason"');
    expect(html).toContain("accounting history is kept");
    expect(html).toContain("Optional partner follow-up consent");
    expect(html).toContain("never changes a Claim, Badge, total XP, or Leaderboard XP");
  });

  it("keeps agenda publication consequences and MCP revocation rules visible", () => {
    const agenda = text(renderToString(() => <AdminAgendaHub />));
    expect(agenda).toContain("Europe/Skopje");
    expect(agenda).toContain("Publishing this Slot also publishes the linked Session.");
    const mcp = text(renderToString(() => <AdminMcpTokensHub />));
    expect(mcp).toContain("Tokens are shown once and cannot be recovered");
    expect(mcp).toContain("Revocation is permanent");
    expect(mcp).toMatch(/<details[^>]*><summary[^>]*>MCP client setup/);
    expect(mcp).toContain("No logo, publication, deletion, or note-approval authority.");
  });

  it("retains independent consent, one-time handoff, and incomplete-source protections", () => {
    const community = text(renderToString(() => <AdminCommunityPartnerMissions operations={() => undefined} onChanged={() => {}} />));
    expect(community).toContain("unchecked, current-User controlled, withdrawable, name/email only");
    expect(community).toContain("separate from every gamification outcome");
    const support = text(renderToString(() => <AdminGamificationSupport activities={[]} achievements={[]} onChanged={() => {}} />));
    expect(support).toContain("consent ID from an authenticated support case only");
    expect(support).toContain("one permitted name/email handoff");
    const sync = text(renderToString(() => <AdminHiEventsReconciliation />));
    expect(sync).toContain("Partial or unavailable data cannot create or void evidence.");
    expect(sync).toMatch(/<button[^>]*disabled[^>]*>Sync and apply/);
  });

  it("retains irreversible and one-time warnings in conditional workflows", () => {
    expect(source("AdminProposalsTable.tsx")).toContain("This action cannot be undone.");
    expect(source("AdminSessionsHub.tsx")).toContain("Clear the legacy start time, track, and room fields? This cannot be undone.");
    expect(source("AdminSessionsHub.tsx")).toContain("Do not paste private CFP review notes here.");
    expect(source("AdminPartnersHub.tsx")).toContain("Editing this note clears agent-visible approval.");
    expect(source("gamification/AdminGamificationHub.tsx")).toContain("Leaving Mission codes clears them automatically.");
    expect(source("gamification/AdminGamificationHub.tsx")).toContain("No raw code can be regenerated.");
    expect(source("gamification/AdminGamificationSupport.tsx")).not.toContain("not implemented in this slice");
  });
});