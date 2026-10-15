type ImageRecord = Record<string, unknown>;

/** Site-relative path that serves a file from EmDash media storage. */
export function mediaFilePath(storageKey: string): string {
	return `/_emdash/api/media/file/${storageKey}`;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Local images carry a storage key in their metadata, or fall back to their id. */
function storageKeyOf(image: ImageRecord): string | undefined {
	const meta = image.meta as ImageRecord | undefined;
	return stringValue(meta?.storageKey) || stringValue(image.id);
}

/** An external image has a src; a local image is served from media storage. */
function imagePath(image: ImageRecord): string | undefined {
	const src = stringValue(image.src);
	if (src) return src;
	const storageKey = storageKeyOf(image);
	return storageKey ? mediaFilePath(storageKey) : undefined;
}

/** Absolute URL for an image field value, or undefined when it has no usable source. */
export function absoluteImageUrl(img: unknown, base: string | URL): string | undefined {
	if (!img || typeof img !== "object") return undefined;
	const path = imagePath(img as ImageRecord);
	return path ? new URL(path, base).href : undefined;
}
