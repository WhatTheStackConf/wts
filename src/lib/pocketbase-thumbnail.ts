const RESIZABLE_IMAGE_EXTENSIONS = /\.(?:gif|jpe?g|png|webp)$/i;

interface ThumbnailSrcSetOptions {
  aspectRatio?: number;
  mode?: "crop" | "fit" | "width";
}

function supportsPocketBaseThumbnail(fileUrl: string): boolean {
  try {
    return RESIZABLE_IMAGE_EXTENSIONS.test(new URL(fileUrl).pathname);
  } catch {
    return false;
  }
}

export function pocketBaseThumbnailUrl(fileUrl: string, size: string): string {
  if (!supportsPocketBaseThumbnail(fileUrl)) return fileUrl;
  const url = new URL(fileUrl);
  url.searchParams.set("thumb", size);
  return url.toString();
}

export function pocketBaseThumbnailSrcSet(
  fileUrl: string,
  widths: readonly number[],
  options: ThumbnailSrcSetOptions = {},
): string | undefined {
  if (!supportsPocketBaseThumbnail(fileUrl)) return undefined;
  const aspectRatio = options.aspectRatio ?? 1;
  const modeSuffix = options.mode === "fit" ? "f" : "";
  return widths
    .map((width) => {
      const height = options.mode === "width" ? 0 : Math.round(width / aspectRatio);
      return `${pocketBaseThumbnailUrl(fileUrl, `${width}x${height}${modeSuffix}`)} ${width}w`;
    })
    .join(", ");
}
