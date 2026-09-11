import { createHash } from "node:crypto";
import { createCheckinDiscoveryAdapter, type CheckinDiscoveryConfig } from "./checkin-hievents.js";
import type { CheckinEventSource } from "./checkin-event-contract.js";

function safeTitle(value: string, fallback: string): string {
  const hasControl = Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  return value.length <= 200 && !hasControl && !/@|:\/\/|www\.|[a-f0-9]{64}|wts_mcp_|bearer\s|password|secret|token\s*[:=]|\/dev\//i.test(value) ? value : fallback;
}
/** Separate from the existing ticket/gamification reader. Credentials and list
 * short IDs live only in this server-side adapter; DTOs are explicit allowlists. */
export function createCheckinEventSource(input?: CheckinDiscoveryConfig, transport: typeof fetch = fetch): CheckinEventSource {
  const config = input ?? { apiUrl: process.env.HIEVENTS_API_URL, apiKey: process.env.HIEVENTS_API_KEY, accountId: process.env.HIEVENTS_ACCOUNT_ID };
  const adapter = createCheckinDiscoveryAdapter(config, transport);
  // Stable account+endpoint scope, not a credential hash: rotating a JWT must
  // not change event identity; changing accounts/servers must never retarget it.
  const sourceKey = createHash("sha256").update(JSON.stringify(["wts2026:hievents", config.apiUrl?.replace(/\/$/, "") ?? "", config.accountId ?? ""])).digest("hex");
  return {
    sourceKey,
    async discover() {
      const result = await adapter.discover();
      return result.status === "complete"
        ? { state: "complete", events: result.data.map((event) => ({ id: event.id, title: safeTitle(event.title, `Hi.Events event ${event.id}`) })) }
        : { state: result.status, events: [] };
    },
    async options(eventId) {
      const result = await adapter.options(eventId);
      if (result.status !== "complete") return { state: result.status, lists: [], questions: [], products: [] };
      return {
        state: "complete",
        lists: result.data.lists.filter((list) => list.isActive && !list.isExpired).map((list) => ({ id: list.id, title: safeTitle(list.title, `Admission list ${list.id}`) })),
        // Label inputs come from attendee/product answers, not order questions.
        questions: result.data.questions.filter((question) => question.belongsTo === "PRODUCT" && ["SINGLE_LINE_TEXT", "MULTI_LINE_TEXT"].includes(question.type)).map((question) => ({ id: question.id, title: safeTitle(question.title, `Affiliation question ${question.id}`), productIds: [...question.productIds] })),
        products: result.data.products.map((product) => ({ id: product.id, title: safeTitle(product.title, `Product ${product.id}`) })),
      };
    },
  };
}
