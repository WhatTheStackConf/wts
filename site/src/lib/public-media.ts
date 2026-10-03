const ASSET_PATH = /^\/media\/([a-f0-9]{64})$/;

export function publicAssetId(source: string, requestUrl: string): string | null {
  try {
    const origin = new URL(requestUrl).origin;
    const url = new URL(source, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    return ASSET_PATH.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
