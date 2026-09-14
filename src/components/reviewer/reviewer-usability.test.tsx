import { readFileSync } from "node:fs";
import { renderToString } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { describe, expect, it, vi } from "vite-plus/test";
import { CfpStepIndicator } from "~/components/cfp/CfpStepIndicator";
import { CfpStepLayout } from "~/components/cfp/CfpStepLayout";

vi.mock("~/layouts/Layout", () => ({
  Layout: (props: { children: JSX.Element }) => <main>{props.children}</main>,
}));

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const clean = (html: string) => html.replace(/<!--.*?-->/g, "");

describe("CFP task layout", () => {
  it.each([1, 2, 3, 4, 5, 6])("keeps all six steps and marks only step %s current", (step) => {
    const html = clean(renderToString(() => <CfpStepIndicator currentStep={step} />));
    expect(html).toContain(`Step ${step} of 6`);
    expect(html.match(/<li\b/g)).toHaveLength(6);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/Completed:/g) || []).toHaveLength(step - 1);
    for (const label of ["Intro", "Personal", "Proposal", "Experience", "Expenses", "Confirm"]) {
      expect(html).toContain(label);
    }
  });

  it("uses one task heading without system jargon or a decorative event heading", () => {
    const html = clean(renderToString(() => (
      <CfpStepLayout title="Talk proposal" description="Submit a talk" step={3}>
        <label>Abstract *</label><textarea name="abstract" />
      </CfpStepLayout>
    )));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Talk proposal</h1>");
    expect(html).toContain("Abstract *");
    expect(html).toContain('name="abstract"');
    expect(html).not.toMatch(/SYS\.|PROTOCOL:|WHATTHESTACK 2026|bg-gradient|font-star/);
  });

  it("retains required applicant guidance and each step's next destination", () => {
    const intro = source("routes/cfp/01-intro.tsx");
    expect(intro).toContain("Submissions are anonymized for committee review");
    expect(intro).toContain("notify you after each decision round");
    expect(intro).toContain("We cover both in full for accepted talks");
    expect(intro).toContain("Topic ideas</summary>");
    expect(intro).not.toContain("AbOUt tO RePlAce");
    const personal = source("routes/cfp/02-personal.tsx");
    const proposal = source("routes/cfp/03-proposal.tsx");
    const experience = source("routes/cfp/04-experience.tsx");
    const expenses = source("routes/cfp/05-expenses.tsx");
    const confirmation = source("routes/cfp/06-confirmation.tsx");
    expect(personal).toContain("Changes update your profile across all submissions.");
    expect(personal).toContain("Full Name *");
    expect(personal).toContain("Short Bio *");
    expect(proposal).toContain("35 minutes including Q&A");
    expect(proposal).toContain("include your estimated duration");
    expect(proposal).toContain("HDMI or USB-C");
    for (const label of ["Title of your talk *", "Abstract *", "Key takeaways *", "Public if your talk is accepted"]) {
      expect(proposal).toContain(label);
    }
    expect(experience).toContain("This step is optional. First-time speakers are welcome");
    expect(expenses).toContain("Can your company cover travel or accommodation? *");
    expect(expenses).toContain("Private to organizers.");
    expect(expenses).toContain('each={["Yes", "No", "Other"]}');
    expect(confirmation).toContain('href="/cfp/02-personal"');
    expect(confirmation).not.toContain('href="/cfp/step-2"');
    for (const [content, next] of [[personal, "03-proposal"], [proposal, "04-experience"], [experience, "05-expenses"], [expenses, "06-confirmation"]]) {
      expect(content).toContain(`navigate("/cfp/${next}")`);
    }
  });
});

describe("reviewer usability contracts", () => {
  it("retains every scoring criterion, range and reviewer-only weight control", () => {
    const review = source("routes/reviewer/[id].tsx");
    const weights = source("components/reviewer/ReviewerWeightsPage.tsx");
    for (const label of ["Relevance", "Originality", "Depth", "Clarity", "Takeaways", "Engagement"]) {
      expect(review).toContain(`label: "${label}"`);
      expect(weights).toContain(`label: "${label}"`);
    }
    expect(review).toContain("min={1}");
    expect(review).toContain("max={5}");
    expect(review).toContain("is_llm_suspected: isLlm()");
    expect(review).toContain('aria-describedby="review-notes-help"');
    expect(weights).toContain("min={1}");
    expect(weights).toContain("max={6}");
    expect(weights).toContain("disabled={!isReviewer()}");
    expect(weights).toContain("<Show when={isReviewer()}>");
    expect(weights).toContain("Committee votes are averaged to weight proposal scores.");
    expect(weights).not.toMatch(/Admin View Mode|GLOBAL AVG:|Votes Saved!|bg-gradient/);
  });

  it("keeps review destinations keyboard-accessible and preserves role guards", () => {
    const queue = source("routes/reviewer/index.tsx");
    expect(queue).toMatch(/<a\s+href=\{`\/reviewer\/\$\{submission.id\}`\}/);
    expect(queue).toContain('navigate("/reviewer/leaderboard")');
    expect(queue).toContain('navigate("/reviewer/weights")');
    expect(queue).toContain("onClick={reviewRandom}");
    for (const path of ["routes/reviewer/index.tsx", "routes/reviewer/leaderboard.tsx", "routes/reviewer/[id].tsx", "components/reviewer/ReviewerWeightsPage.tsx"]) {
      expect(source(path)).toContain("guard.authorized()");
      expect(source(path)).not.toContain("bg-gradient");
    }
  });
});