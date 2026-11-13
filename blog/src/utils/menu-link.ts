/** Links that open a new browsing context must not expose this page to the opened one. */
export function menuLinkRel(target: string | undefined): string | undefined {
	return target === "_blank" ? "noopener noreferrer" : undefined;
}

/** Links that leave the blog get the outbound arrow. */
export function isOutboundLink(url: string, target: string | undefined): boolean {
	return target === "_blank" || /^https?:\/\//.test(url);
}

function trimTrailingSlash(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * aria-current for a menu link: "page" on its own page, "true" inside its section
 * (such as a post under /posts), and nothing elsewhere.
 */
export function menuLinkCurrent(url: string, pathname: string): "page" | "true" | undefined {
	if (!url.startsWith("/")) return undefined;
	const link = trimTrailingSlash(url);
	const page = trimTrailingSlash(pathname);
	if (link === page) return "page";
	if (link !== "/" && page.startsWith(`${link}/`)) return "true";
	return undefined;
}
