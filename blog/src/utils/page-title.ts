function includesSiteName(title: string, siteTitle: string): boolean {
	return (
		title === siteTitle ||
		title.endsWith(` | ${siteTitle}`) ||
		title.endsWith(` — ${siteTitle}`)
	);
}

/** Document title: the page title followed by the site name, unless it already names the site. */
export function fullPageTitle(title: string, siteTitle: string): string {
	return includesSiteName(title, siteTitle) ? title : `${title} — ${siteTitle}`;
}
