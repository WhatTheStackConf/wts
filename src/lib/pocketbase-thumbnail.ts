const OPTIMIZABLE_IMAGE_EXTENSIONS = /\.(?:gif|jpe?g|png|svg|webp)$/i;

interface ThumbnailSrcSetOptions {
  aspectRatio?: number;
  mode?: "crop" | "fit" | "width";
}

function supportsOptimizedImage(fileUrl: string): boolean {
  try {
    return OPTIMIZABLE_IMAGE_EXTENSIONS.test(new URL(fileUrl).pathname);
  } catch {
    return false;
  }
}

export function pocketBaseThumbnailUrl(fileUrl: string, size: string): string {
  if (!supportsOptimizedImage(fileUrl)) return fileUrl;
  const dimensions = /^(\d+)x(\d+)(f?)$/.exec(size);
  if (!dimensions) return fileUrl;

  const params = new URLSearchParams({
    src: fileUrl,
    width: dimensions[1],
  });
  if (dimensions[2] !== "0") params.set("height", dimensions[2]);
  if (dimensions[3]) params.set("fit", "contain");

  return `/api/image?${params.toString()}`;
}

export function pocketBaseThumbnailSrcSet(
  fileUrl: string,
  widths: readonly number[],
  options: ThumbnailSrcSetOptions = {},
): string | undefined {
  if (!supportsOptimizedImage(fileUrl)) return undefined;
  const aspectRatio = options.aspectRatio ?? 1;
  const modeSuffix = options.mode === "fit" ? "f" : "";
  return widths
    .map((width) => {
      const height = options.mode === "width" ? 0 : Math.round(width / aspectRatio);
      return `${pocketBaseThumbnailUrl(fileUrl, `${width}x${height}${modeSuffix}`)} ${width}w`;
    })
    .join(", ");
}
