// Builds the "On this page" list from the article's h2/h3 headings and marks
// the link of the section in view. Browsers with scroll-target-group style the
// link through :target-current; the others get the .target-current fallback.
// Both keep aria-current in sync, because the pseudo-class is visual only.

const LINK_SELECTOR = ".toc-link";

function hideToc(): void {
	const toc = document.querySelector<HTMLElement>(".toc");
	if (toc) toc.hidden = true;
}

function tocItem(heading: HTMLElement, index: number): HTMLLIElement {
	if (!heading.id) heading.id = `heading-${index}`;
	// A focusable target lets keyboard users continue from the section they jumped to.
	if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;

	const li = document.createElement("li");
	li.className = heading.tagName === "H3" ? "toc-item toc-item--nested" : "toc-item";

	const link = document.createElement("a");
	link.href = `#${heading.id}`;
	link.className = "toc-link";
	link.textContent = heading.textContent;

	li.appendChild(link);
	return li;
}

function markCurrent(links: HTMLAnchorElement[], current: Element | null, useClass: boolean): void {
	for (const link of links) {
		const isCurrent = link === current;
		if (useClass) link.classList.toggle("target-current", isCurrent);
		if (isCurrent) link.setAttribute("aria-current", "true");
		else link.removeAttribute("aria-current");
	}
}

/** Native scrollspy: read the browser's :target-current when scrolling ends. */
function syncNative(list: HTMLElement, links: HTMLAnchorElement[]): void {
	const sync = () => markCurrent(links, list.querySelector(`${LINK_SELECTOR}:target-current`), false);
	sync();
	document.addEventListener("scrollend", sync);
}

/** Fallback scrollspy: the heading that crosses the band below the header is current. */
function observeHeadings(list: HTMLElement, links: HTMLAnchorElement[], headings: HTMLElement[]): void {
	const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 90;
	const observer = new IntersectionObserver(
		(entries) => {
			const entry = entries.find((item) => item.isIntersecting);
			if (!entry) return;
			const current = list.querySelector(`a[href="#${CSS.escape(entry.target.id)}"]`);
			markCurrent(links, current, true);
		},
		{ rootMargin: `-${Math.round(headerHeight)}px 0px -70% 0px` },
	);
	headings.forEach((heading) => observer.observe(heading));
}

export function buildToc(): void {
	const content = document.querySelector(".article-content");
	const tocContainer = document.getElementById("toc-content");
	if (!content || !tocContainer) return;

	const headings = Array.from(content.querySelectorAll<HTMLElement>("h2, h3"));
	if (headings.length === 0) {
		hideToc();
		return;
	}

	const list = document.createElement("ul");
	list.className = "toc-list";
	headings.forEach((heading, index) => list.appendChild(tocItem(heading, index)));
	tocContainer.appendChild(list);

	const links = Array.from(list.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR));
	if (CSS.supports("scroll-target-group: auto")) syncNative(list, links);
	else observeHeadings(list, links, headings);
}
