import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vite-plus/test";
import { CfpStepIndicator } from "~/components/cfp/CfpStepIndicator";
const clean = (html: string) => html.replace(/<!--.*?-->/g, "");

describe("CFP task layout", () => {
  it.each([1, 2, 3, 4, 5, 6])("keeps all six steps and marks only step %s current", (step) => {
    const html = clean(renderToString(() => <CfpStepIndicator currentStep={step} />));
    expect(html.match(/<li\b/g)).toHaveLength(6);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/Completed:/g) || []).toHaveLength(step - 1);
  });

});
