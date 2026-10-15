import type { AstroGlobal } from "astro";

type RouteCache = AstroGlobal["cache"];
type CacheInput = Parameters<RouteCache["set"]>[0];

/** Merge cache hints into the route cache, when route caching is enabled. */
export function applyCacheHints(cache: RouteCache | undefined, ...hints: CacheInput[]): void {
	if (!cache?.enabled) return;
	for (const hint of hints) cache.set(hint);
}
