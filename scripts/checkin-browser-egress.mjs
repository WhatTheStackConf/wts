// Loaded only into the disposable built server. No response simulation: any
// unexpected external fetch fails rather than ever reaching a real dependency.
// The third loopback service is an explicitly synthetic upstream, never Hi.Events.
const allowed = new Set([process.env.POCKETBASE_URL, process.env.SITE_URL, new URL(process.env.HIEVENTS_API_URL).origin]);
for (const origin of allowed) {
  if (!origin || new URL(origin).hostname !== "127.0.0.1") throw new Error("Disposable egress guard requires loopback services");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!allowed.has(url.origin)) return Promise.reject(new Error("External fetch denied by disposable Check-in harness"));
  return originalFetch(input, init);
};
