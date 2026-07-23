import { describe, expect, it } from "vitest";
import {
  qrDiscountSlugs,
  resolveQrDiscount,
} from "~/lib/qr-discounts";

describe("legacy QR discount routes", () => {
  it.each([
    ["lucifer", "Please be good", "We don't know that."],
    ["object", "[string: Title]", "Don't you hate these?"],
    ["ping-pong", "We have cookies?", "Not the sporty type, or working remote?"],
    ["raise", "Inflation goes brrr", "Finally, a reason for that raise!"],
    ["skopje-e-moj-grad", "*crickets?*", "Check again!"],
    ["t-shirts", "Swag", "Hopefully you can grab some."],
    ["zero", "arr[0]", "Welcome to our bunch!"],
  ])("resolves /qr/%s to its themed 5%% offer", (slug, title, lead) => {
    expect(resolveQrDiscount(slug)).toMatchObject({
      slug,
      title,
      lead,
      discountPercentage: 5,
      checkoutUrl:
        "https://hievents.foundry.mk/event/5/whatthestack-2026?promo_code=WTS-QR-5",
    });
  });

  it("keeps the complete set of printed sticker routes available", () => {
    expect(qrDiscountSlugs).toEqual([
      "lucifer",
      "object",
      "ping-pong",
      "raise",
      "skopje-e-moj-grad",
      "t-shirts",
      "zero",
    ]);
  });

  it("does not resolve unknown QR routes", () => {
    expect(resolveQrDiscount("unknown")).toBeUndefined();
  });
});
