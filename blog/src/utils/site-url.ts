/** Base for absolute URLs: the configured site, or the request origin when no site is configured. */
export function siteBase(site: URL | undefined, requestUrl: URL): URL | string {
	return site ?? requestUrl.origin;
}

/** Origin of the configured site, or of the request when no site is configured. */
export function siteOrigin(site: URL | undefined, requestUrl: URL): string {
	return site?.origin ?? requestUrl.origin;
}
