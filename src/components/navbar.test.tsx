import { renderToString } from "@solidjs/web";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ cfp: undefined as unknown }));

vi.mock("~/lib/async-resource", () => ({ createAsyncResource: () => [Object.assign(() => state.cfp, { loading: false })] }));
vi.mock("~/lib/cfp-utils", () => ({ fetchCfpConfig: vi.fn() }));
vi.mock("~/lib/auth-context", () => ({
  useAuth: () => ({ isLoading: () => false, isAuthenticated: () => true, user: { id: "user-1", role: "admin" } }),
}));

import { Navbar } from "./Navbar";
import { links, markup } from "./route-markup-test-helper";

const homeLink = "/ WhatTheStack2 0 2 7";
const aboutLinks = ["/#about > About WhatTheStack", "https://2025.wts.sh > 2025 Edition", "https://2024.wts.sh > 2024 Edition"];
const chrome = [
  '<input id="mobile-drawer" type="checkbox" tabindex="-1" aria-hidden="true">',
  '<button id="mobile-navigation-open" type="button" aria-label="open sidebar" aria-controls="mobile-navigation" aria-expanded="false"><svg/></button>',
  '<a href="/" aria-label="WhatTheStack 2 0 2 7 home">',
  '<img src="/src/assets/images/LogoSolo.svg" alt>',
  "<span>What</span><span>The</span><span>Stack</span></span><span>2 0 2 7</span>",
  '<button type="button" popovertarget="nav-about">About</button><ul popover id="nav-about">',
  '<a href="https://2025.wts.sh" target="_blank">> 2025 Edition</a>',
  '<a href="https://2024.wts.sh" target="_blank">> 2024 Edition</a>',
];

beforeEach(() => {
  state.cfp = undefined;
});

describe("Navbar markup", () => {
  it("renders the closed-drawer navigation before mount", () => {
    const html = markup(renderToString(() => <Navbar />));
    for (const fragment of chrome) expect(html).toContain(fragment);
    expect(html).not.toContain('id="mobile-navigation"');
    expect(html).not.toContain("Get Involved");
    expect(links(html)).toEqual([homeLink, ...aboutLinks]);
  });

  it("adds the Get Involved menu while the CFP is open", () => {
    state.cfp = { cfp_open: true };
    const html = markup(renderToString(() => <Navbar />));
    for (const fragment of chrome) expect(html).toContain(fragment);
    expect(html).toContain('<button type="button" popovertarget="nav-involved">Get Involved</button><ul popover id="nav-involved"><li><a href="/cfp">> Apply to speak</a></li></ul>');
    expect(links(html)).toEqual([homeLink, "/cfp > Apply to speak", ...aboutLinks]);
  });
});
