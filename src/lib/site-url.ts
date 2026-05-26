import { getRequestEvent } from "solid-js/web";

const SITE_ORIGIN_ENV_KEYS = [
  "PUBLIC_SITE_URL",
  "SITE_URL",
  "VITE_SITE_URL",
] as const;

function pickEnvValue(keys: readonly string[]): string | undefined {
  if (typeof process !== "undefined") {
    for (const key of keys) {
      const value = process.env[key];
      if (value) return value;
    }
  }

  if (typeof import.meta !== "undefined" && import.meta.env) {
    const env = import.meta.env as Record<string, string | undefined>;
    for (const key of keys) {
      const value = env[key];
      if (value) return value;
    }
  }

  return undefined;
}

/** Canonical site origin for absolute Open Graph / canonical URLs. */
export function getSiteOrigin(): string {
  const fromEnv = pickEnvValue(SITE_ORIGIN_ENV_KEYS);
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      return fromEnv.replace(/\/$/, "");
    }
  }

  const event = getRequestEvent();
  if (event?.request) {
    return new URL(event.request.url).origin;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "";
}

/** Resolve a path or URL to an absolute URL using {@link getSiteOrigin}. */
export function toAbsoluteUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;

  const origin = getSiteOrigin();
  if (!origin) return url;

  const path = url.startsWith("/") ? url : `/${url}`;
  return `${origin.replace(/\/$/, "")}${path}`;
}
