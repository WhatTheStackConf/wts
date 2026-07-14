import { createHash, randomBytes } from "node:crypto";

interface PublicMcpProtectionInput {
  clientAddress?: string;
  weight: number;
  now?: number;
}

type PublicMcpProtectionResult =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfter: number };

interface WindowCounter {
  count: number;
  expiresAt: number;
}

const PROCESS_SALT = randomBytes(32);
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_BURST_LIMIT = 120;
const DEFAULT_GLOBAL_LIMIT = 1_200;
const DEFAULT_CONCURRENCY_LIMIT = 48;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function retryAfterSeconds(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
}

class MemoryPublicMcpProtection {
  private readonly perAddress = new Map<string, WindowCounter>();
  private global: WindowCounter = { count: 0, expiresAt: 0 };
  private inFlightWeight = 0;

  reset() {
    this.perAddress.clear();
    this.global = { count: 0, expiresAt: 0 };
    this.inFlightWeight = 0;
  }

  acquire(input: PublicMcpProtectionInput): PublicMcpProtectionResult {
    const now = input.now ?? Date.now();
    const weight = Math.max(1, Math.floor(input.weight));
    const windowMs = positiveInteger(process.env.MCP_PUBLIC_RATE_WINDOW_MS, DEFAULT_WINDOW_MS);
    const burstLimit = positiveInteger(process.env.MCP_PUBLIC_BURST_LIMIT, DEFAULT_BURST_LIMIT);
    const globalLimit = positiveInteger(process.env.MCP_PUBLIC_GLOBAL_LIMIT, DEFAULT_GLOBAL_LIMIT);
    const concurrencyLimit = positiveInteger(
      process.env.MCP_PUBLIC_CONCURRENCY_LIMIT,
      DEFAULT_CONCURRENCY_LIMIT,
    );

    for (const [key, counter] of this.perAddress) {
      if (counter.expiresAt <= now) this.perAddress.delete(key);
    }
    if (this.global.expiresAt <= now) {
      this.global = { count: 0, expiresAt: now + windowMs };
    }

    const addressKey = input.clientAddress
      ? createHash("sha256").update(PROCESS_SALT).update(input.clientAddress).digest("hex")
      : undefined;
    const addressCounter = addressKey
      ? this.perAddress.get(addressKey) ?? { count: 0, expiresAt: now + windowMs }
      : undefined;

    if (addressCounter && addressCounter.count + weight > burstLimit) {
      return { allowed: false, retryAfter: retryAfterSeconds(addressCounter.expiresAt, now) };
    }
    if (this.global.count + weight > globalLimit) {
      return { allowed: false, retryAfter: retryAfterSeconds(this.global.expiresAt, now) };
    }
    if (this.inFlightWeight + weight > concurrencyLimit) {
      return { allowed: false, retryAfter: 1 };
    }

    if (addressKey && addressCounter) {
      addressCounter.count += weight;
      this.perAddress.set(addressKey, addressCounter);
    }
    this.global.count += weight;
    this.inFlightWeight += weight;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlightWeight = Math.max(0, this.inFlightWeight - weight);
      },
    };
  }
}

export const publicMcpProtection = new MemoryPublicMcpProtection();

export function resetPublicMcpProtection() {
  publicMcpProtection.reset();
}
