export interface TagLink {
	slug: string;
	label: string;
}

/** Slug and label of each tag term, for tag links. A missing term list means no tags. */
export function toTagLinks(terms: readonly TagLink[] | undefined): TagLink[] {
	return (terms ?? []).map((term) => ({ slug: term.slug, label: term.label }));
}
