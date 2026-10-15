import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { FeedbackForm } from "./FeedbackForm";

const token = "sensitive-invitation-token-not-for-dom-output";
const survey = { title: "WhatTheStack 2026 feedback", version: "v1", closesAt: "2026-10-05T21:59:00Z", sessions: [{ id: "real-session", title: "An actual session title" }] };
const render = () => renderToString(() => <FeedbackForm token={token} survey={survey} onComplete={() => {}} />);

describe("feedback form rendering", () => {
  it("requires only the overall native radio group", () => {
    const html = render();
    const requiredInputs = html.match(/<input\b[^>]*\brequired(?:[ =][^>]*)?>/g) ?? [];
    expect(requiredInputs).toHaveLength(5);
    for (const input of requiredInputs) expect(input).toContain('name="overall"');
    expect(html).not.toContain('aria-invalid="true"');
  });
  it("offers actual session titles and never renders the bearer token", () => {
    const html = render();
    expect(html).toContain('value="real-session"');
    expect(html).toContain("An actual session title");
    expect(html).not.toContain(token);
    expect(html).not.toContain('name="moreOther"');
  });
  it("renders optional N/A independently for each part and explicit text limits", () => {
    const html = render();
    for (const part of ["content", "organisation", "venue", "connections"]) expect(html).toContain(`name="part:${part}" value="na"`);
    expect(html).toMatch(/<textarea[^>]*name="keep"[^>]*maxlength="2000"/);
    expect(html).toMatch(/<textarea[^>]*name="change"[^>]*maxlength="2000"/);
  });
});
