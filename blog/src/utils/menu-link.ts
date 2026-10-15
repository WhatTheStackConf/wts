/** Links that open a new browsing context must not expose this page to the opened one. */
export function menuLinkRel(target: string | undefined): string | undefined {
	return target === "_blank" ? "noopener noreferrer" : undefined;
}
