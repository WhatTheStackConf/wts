import { getEmDashCollection, getTermsForEntries } from "emdash";
import { getReadingTime } from "./reading-time";
import { toTagLinks } from "./tag-links";

const RELATED_POST_COUNT = 3;

/** The most recent posts other than the current one, as post card props. */
export async function getRelatedPostCards(currentPostId: string) {
	// Fetch one extra recent post in case the current post is among them.
	const { entries: recentPosts, cacheHint } = await getEmDashCollection("posts", {
		orderBy: { published_at: "desc" },
		limit: RELATED_POST_COUNT + 1,
	});
	const otherPosts = recentPosts
		.filter((p) => p.id !== currentPostId)
		.slice(0, RELATED_POST_COUNT);

	// Single batched query for related-posts tags, rather than one
	// getEntryTerms() call per related post.
	const tagsByEntry = await getTermsForEntries(
		"posts",
		otherPosts.map((p) => p.data.id),
		"tag",
	);

	const cards = otherPosts.map((p) => ({
		title: p.data.title,
		excerpt: p.data.excerpt,
		featuredImage: p.data.featured_image,
		href: `/posts/${p.id}`,
		date: p.data.publishedAt ?? undefined,
		readingTime: getReadingTime(p.data.content),
		tags: toTagLinks(tagsByEntry.get(p.data.id)),
		bylines: p.data.bylines ?? [],
		edit: p.edit,
	}));

	return { cards, cacheHint };
}
