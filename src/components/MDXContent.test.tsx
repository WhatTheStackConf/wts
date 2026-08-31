import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { MDXContent } from "~/components/MDXContent";
import { pages } from ".velite";

describe("MDXContent", () => {
  it("renders Velite MDX with the Solid 2 runtime", () => {
    const page = pages.find((entry) => entry.slug === "about");

    expect(page).toBeDefined();

    const html = renderToString(() => <MDXContent code={page!.content} />);

    expect(html).toContain("A by-developers, for-developers event");
    expect(html).toContain("Skopje, North Macedonia");
  });
});
