import PocketBase, { type RecordModel } from "pocketbase";

const DEFAULT_PUBLIC_PB_URL = "http://127.0.0.1:8090";

/** Env keys in priority order; PUBLIC_POCKETBASE_URL is canonical in production. */
const PUBLIC_PB_ENV_KEYS = [
  "PUBLIC_POCKETBASE_URL",
  "POCKETBASE_PUBLIC_URL",
  "VITE_POCKETBASE_URL",
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

/**
 * Base URL for PocketBase file links and browser-facing API calls.
 * Must be reachable from the user's browser — never the Docker-internal host.
 *
 * Resolution: PUBLIC_POCKETBASE_URL → POCKETBASE_PUBLIC_URL → VITE_POCKETBASE_URL
 * POCKETBASE_URL is intentionally excluded; it is often `http://pocketbase:8090`.
 */
export function getPocketBasePublicBaseUrl(): string {
  const url = pickEnvValue(PUBLIC_PB_ENV_KEYS) ?? DEFAULT_PUBLIC_PB_URL;
  return String(url).replace(/\/$/, "");
}

let publicPb: PocketBase | undefined;

function getPublicPb(): PocketBase {
  if (!publicPb) {
    publicPb = new PocketBase(getPocketBasePublicBaseUrl());
  }
  return publicPb;
}

type FileRecordRef = Pick<RecordModel, "id"> & {
  collectionId?: string;
  collectionName?: string;
};

/**
 * Build a browser-safe PocketBase file URL using the public base URL.
 */
export function getPbFileUrl(
  collection: string,
  recordId: string,
  filename: string,
): string;
export function getPbFileUrl(record: FileRecordRef, filename: string): string;
export function getPbFileUrl(
  collectionOrRecord: string | FileRecordRef,
  recordIdOrFilename: string,
  filename?: string,
): string {
  const pb = getPublicPb();

  if (typeof collectionOrRecord === "string") {
    const record: FileRecordRef = {
      id: recordIdOrFilename,
      collectionName: collectionOrRecord,
    };
    return pb.files.getURL(record, filename!);
  }

  return pb.files.getURL(collectionOrRecord, recordIdOrFilename);
}
