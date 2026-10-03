import { readFile } from "node:fs/promises";
import { EmDashClient, csrfInterceptor, devBypassInterceptor } from "emdash/client";

const baseUrl = new URL(process.env.EMDASH_URL ?? "http://localhost:4321");
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("This migration supports only the local blog. Use EmDash site transfer for deployment.");
}
const client = new EmDashClient({ baseUrl: baseUrl.href, devBypass: true });
const authenticate = devBypassInterceptor(baseUrl.href);
const csrf = csrfInterceptor();
const dates = JSON.parse(await readFile(new URL("../seed/publication-dates.json", import.meta.url), "utf8"));

for (const [slug, publishedAt] of Object.entries(dates)) {
  const item = await client.get("posts", slug, { raw: true });
  if (item.publishedAt === publishedAt) {
    console.log(`${slug}: original date already present.`);
    continue;
  }
  if (item.draftRevisionId) {
    throw new Error(`${slug} has a pending draft. Resolve the draft before this migration.`);
  }
  const request = new Request(new URL(`/_emdash/api/content/posts/${item.id}/publish`, baseUrl), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publishedAt }),
  });
  const response = await authenticate(request, (authorized) => csrf(authorized, (ready) => fetch(ready)));
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`${slug}: ${result.error?.message ?? response.status}`);
  const saved = await client.get("posts", slug, { raw: true });
  if (saved.publishedAt !== publishedAt) throw new Error(`${slug}: the original publication date did not persist.`);
  console.log(`${slug}: restored ${publishedAt.slice(0, 10)}.`);
}
