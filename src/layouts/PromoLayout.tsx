import { JSX } from "solid-js";
import { Title, Meta, Link } from "@solidjs/meta";
import CodeBackground from "~/components/CodeBackground";
import { toAbsoluteUrl } from "~/lib/site-url";
import {
  conferenceDefaultDescription,
  conferenceDefaultOgSubtitle,
  conferenceName,
} from "~/lib/conference-guide-content";

const DEFAULT_TITLE = conferenceName;
const DEFAULT_DESCRIPTION = conferenceDefaultDescription;
const DEFAULT_OG_SUBTITLE = conferenceDefaultOgSubtitle;

interface PromoLayoutProps {
  children: JSX.Element;
  title?: string;
  description?: string;
  /** Speaker photo or other image; absolute URLs used as-is. */
  ogImage?: string | null;
  ogSubtitle?: string;
}

export const PromoLayout = (props: PromoLayoutProps) => {
  const title = () => props.title ?? DEFAULT_TITLE;
  const description = () => props.description ?? DEFAULT_DESCRIPTION;
  const ogSubtitle = () => props.ogSubtitle ?? DEFAULT_OG_SUBTITLE;
  const ogImageUrl = () => {
    const image = props.ogImage?.trim();
    if (image) return toAbsoluteUrl(image);
    return toAbsoluteUrl(
      `/api/og?title=${encodeURIComponent(title())}&subtitle=${encodeURIComponent(ogSubtitle())}`,
    );
  };

  return (
    <>
      <Title>{title()}</Title>
      <Link rel="icon" href="/favicon.svg" />
      <Meta name="description" content={description()} />
      <Meta property="og:title" content={title()} />
      <Meta property="og:description" content={description()} />
      <Meta property="og:image" content={ogImageUrl()} />
      <Meta property="og:type" content="website" />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="robots" content="index,follow" />
      <main class="font-sans relative w-full min-h-screen flex flex-col items-center overflow-x-hidden bg-dark-950">
        <CodeBackground />
        <div
          class="promo-starfield absolute inset-0 z-10 pointer-events-none"
          aria-hidden="true"
        />
        <div class="absolute z-20 inset-0 bg-black/82" aria-hidden="true" />
        <div class="relative z-30 w-full flex flex-col items-center justify-center flex-grow px-4 py-12 md:py-16">
          {props.children}
        </div>
      </main>
    </>
  );
};
