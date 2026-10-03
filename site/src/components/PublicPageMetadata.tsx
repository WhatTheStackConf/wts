import { Link, Meta, Title } from "@solidjs/meta";
import { useLocation } from "@solidjs/router";
import { toAbsoluteUrl } from "~/lib/site-url";

interface PublicPageMetadataProps {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogSubtitle?: string;
  ogImage?: string | null;
  titleSuffix?: string;
  canonicalUrl?: string;
}

export function PublicPageMetadata(props: PublicPageMetadataProps) {
  const location = useLocation();
  const pageTitle = () => `${props.title}${props.titleSuffix || ""}`;
  const shareTitle = () => props.ogTitle || pageTitle();
  const shareDescription = () => props.ogDescription || props.description;
  const canonical = () => props.canonicalUrl || toAbsoluteUrl(location.pathname);
  const image = () => {
    const providedImage = props.ogImage?.trim();
    if (providedImage) return toAbsoluteUrl(providedImage);
    const subtitle = props.ogSubtitle || shareDescription();
    const imagePath = `/api/og?title=${encodeURIComponent(shareTitle())}&subtitle=${encodeURIComponent(subtitle)}`;
    const base = canonical();
    return /^https?:\/\//i.test(base) ? new URL(imagePath, base).href : toAbsoluteUrl(imagePath);
  };

  return (
    <>
      <Title>{pageTitle()}</Title>
      <Meta name="description" content={props.description} />
      <Link rel="canonical" href={canonical()} />
      <Meta property="og:title" content={shareTitle()} />
      <Meta property="og:description" content={shareDescription()} />
      <Meta property="og:url" content={canonical()} />
      <Meta property="og:image" content={image()} />
      <Meta property="og:type" content="website" />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={shareTitle()} />
      <Meta name="twitter:description" content={shareDescription()} />
      <Meta name="twitter:image" content={image()} />
    </>
  );
}
