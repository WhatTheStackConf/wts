// Observed Hi.Events paginator shape only; synthetic hosts and identities throughout.
type Paginated = { meta: Record<string, unknown> & { current_page_url: string; to: unknown }; links: Record<string, unknown> };

/** Rewrites absolute metadata URLs to the stripped mount and adds current_page_url. */
export function strippedPage(base: string, body: unknown) {
  const copy = JSON.parse(JSON.stringify(body).replaceAll(`${base}/`, `${base.slice(0, -4)}/`));
  copy.meta.current_page_url = `${copy.meta.path}?page=${copy.meta.current_page}`;
  return copy;
}

const separator = (field: string) => field === "path" ? "?" : "&";
const corruptions: Record<string, (value: string, field: string, base: URL) => string> = {
  origin: (value, _field, base) => value.replace(base.host, "foreign.example.invalid"),
  capability: (value) => value.replace(/cil_[^/]+|events\/[0-9]+/, "other-list"),
  query: (value, field) => `${value}${separator(field)}extra=1`,
  "changed query": (value, field) => `${value}${separator(field)}query=A-ABC1235`,
  "duplicate query": (value, field) => `${value}${separator(field)}query=A-ABC1234&query=A-ABC1234`,
  "wrong mount": (value, _field, base) => value.replace(base.origin, `${base.origin}/api/api`),
  duplicate: (value, field) => `${value}${separator(field)}per_page=1&per_page=1`,
  credentials: (value) => value.replace("https://", "https://user:pass@"),
  fragment: (value) => `${value}#fragment`,
};

/** Corrupts one metadata URL field, or the page count, in a stripped page. */
export function corruptPage(base: string, body: Paginated, field: string, kind: string) {
  if (kind === "count") { body.meta.to = 2; return; }
  const corruption = corruptions[kind];
  if (!corruption) return;
  const owner = field === "path" || field === "current_page_url" ? body.meta : body.links;
  owner[field] = corruption(owner[field] as string, field, new URL(base));
}
