// Builds the "On this page" list from the article's h2/h3 headings and
// highlights the link of the section that is currently in view.

function hideToc(): void {
	const toc = document.querySelector(".toc") as HTMLElement | null;
	if (toc) toc.style.display = "none";
}

function tocItem(heading: Element, index: number): HTMLLIElement {
	// Add ID if missing
	if (!heading.id) {
		heading.id = `heading-${index}`;
	}

	const li = document.createElement("li");
	li.className = heading.tagName === "H3" ? "toc-item toc-item--nested" : "toc-item";

	const link = document.createElement("a");
	link.href = `#${heading.id}`;
	link.className = "toc-link";
	link.textContent = heading.textContent;

	li.appendChild(link);
	return li;
}

function setActiveLink(tocContainer: HTMLElement, entry: IntersectionObserverEntry): void {
	const link = tocContainer.querySelector(`a[href="#${entry.target.id}"]`);
	if (!link || !entry.isIntersecting) return;
	tocContainer.querySelectorAll(".toc-link").forEach((l) => l.classList.remove("active"));
	link.classList.add("active");
}

function highlightOnScroll(tocContainer: HTMLElement, headings: NodeListOf<Element>): void {
	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => setActiveLink(tocContainer, entry));
		},
		{ rootMargin: "-80px 0px -80% 0px" },
	);

	headings.forEach((heading) => observer.observe(heading));
}

export function buildToc(): void {
	const content = document.querySelector(".article-content");
	const tocContainer = document.getElementById("toc-content");
	if (!content || !tocContainer) return;

	const headings = content.querySelectorAll("h2, h3");
	if (headings.length === 0) {
		hideToc();
		return;
	}

	const list = document.createElement("ul");
	list.className = "toc-list";
	headings.forEach((heading, index) => list.appendChild(tocItem(heading, index)));
	tocContainer.appendChild(list);

	highlightOnScroll(tocContainer, headings);
}
