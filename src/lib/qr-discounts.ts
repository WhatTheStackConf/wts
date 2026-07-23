export const QR_DISCOUNT_CODE = "WTS-QR-5";
export const QR_DISCOUNT_PERCENTAGE = 5;
export const QR_DISCOUNT_EVENT_URL =
  "https://hievents.foundry.mk/event/5/whatthestack-2026";

export const qrDiscountSlugs = [
  "lucifer",
  "object",
  "ping-pong",
  "raise",
  "skopje-e-moj-grad",
  "t-shirts",
  "zero",
] as const;

export type QrDiscountSlug = (typeof qrDiscountSlugs)[number];

interface QrDiscountCopy {
  title: string;
  lead: string;
  body: string;
}

export interface QrDiscountPage extends QrDiscountCopy {
  slug: QrDiscountSlug;
  discountPercentage: typeof QR_DISCOUNT_PERCENTAGE;
  checkoutUrl: string;
}

const qrDiscountCopy: Record<QrDiscountSlug, QrDiscountCopy> = {
  lucifer: {
    title: "Please be good",
    lead: "We don't know that.",
    body: "Luckily, there is a quick way to check. Send him this page and wait for the results.",
  },
  object: {
    title: "[string: Title]",
    lead: "Don't you hate these?",
    body: "Join us in Skopje for a full day of software, code, and people who know exactly why this is annoying.",
  },
  "ping-pong": {
    title: "We have cookies?",
    lead: "Not the sporty type, or working remote?",
    body: "Train your digits instead with a week of warmup events and a full conference day.",
  },
  raise: {
    title: "Inflation goes brrr",
    lead: "Finally, a reason for that raise!",
    body: "Join WhatTheStack, sharpen your skills, and make the next salary conversation easier.",
  },
  "skopje-e-moj-grad": {
    title: "*crickets?*",
    lead: "Check again!",
    body: "Meet your people in Skopje for a full conference day, community events, and an after party.",
  },
  "t-shirts": {
    title: "Swag",
    lead: "Hopefully you can grab some.",
    body: "Join us for the conference and see if you can snag your new favorite pajama shirt.",
  },
  zero: {
    title: "arr[0]",
    lead: "Welcome to our bunch!",
    body: "Join the first item in the stack and meet hundreds more people who care about software and code.",
  },
};

function isQrDiscountSlug(slug: string): slug is QrDiscountSlug {
  return Object.hasOwn(qrDiscountCopy, slug);
}

export function resolveQrDiscount(
  slug: string | undefined,
): QrDiscountPage | undefined {
  if (!slug || !isQrDiscountSlug(slug)) return undefined;

  const checkoutUrl = new URL(QR_DISCOUNT_EVENT_URL);
  checkoutUrl.searchParams.set("promo_code", QR_DISCOUNT_CODE);

  return {
    slug,
    ...qrDiscountCopy[slug],
    discountPercentage: QR_DISCOUNT_PERCENTAGE,
    checkoutUrl: checkoutUrl.toString(),
  };
}
