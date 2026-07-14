import { createHash } from "node:crypto";
import type {
  AdminActionCompletion,
  AdminActionHandle,
  AdminActionRecord,
  AdminActionRequest,
  AdminActionSource,
  AdminActionValue,
} from "~/lib/admin-action-ledger";
import { AdminActions } from "~/lib/admin-action-ledger";
import type { PartnerRecord } from "~/lib/pocketbase-types";

export const PARTNER_TYPES = [
  "organizer",
  "sponsor",
  "supporter",
  "community_partner",
  "media",
  "catering",
  "other",
] as const satisfies readonly PartnerRecord["type"][];
export const PARTNER_TIERS = ["platinum", "gold", "silver", "bronze"] as const;
const PARTNER_LOGO_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
];
const PARTNER_LOGO_MAX_BYTES = 5 * 1024 * 1024;

export type PartnerLogoPayload = {
  name: string;
  type: string;
  data: number[];
};

export type PartnerAdministrationActor = "human_admin" | "agent";

export interface PartnerAdministrationActorContext {
  mode: PartnerAdministrationActor;
  userId: string;
  source: AdminActionSource;
  mcpTokenId?: string;
}

export interface PartnerStoreAdminAction {
  handle: AdminActionHandle;
  operationKind: string;
  targetId?: string;
  normalizedInput: AdminActionValue;
  completion: AdminActionCompletion;
  complete(completion: AdminActionCompletion): Promise<AdminActionRecord>;
  isApplied(): Promise<boolean>;
}

export interface PartnerStoredRecord {
  id: string;
  name: string;
  normalizedName: string;
  published: boolean;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logo: string;
  logoUploadedByHuman: boolean;
  url?: string;
  canonicalUrl: string;
  notes?: string;
  noteAgentVisible: boolean;
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface PartnerStoreCreateInput {
  name: string;
  normalizedName: string;
  published: false;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logo?: PartnerLogoPayload;
  logoUploadedByHuman: boolean;
  url?: string;
  canonicalUrl: string;
  notes?: string;
  noteAgentVisible: false;
}

export interface PartnerStoreUpdateInput {
  name: string;
  normalizedName: string;
  published: boolean;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logo?: PartnerLogoPayload | null;
  logoUploadedByHuman: boolean;
  url?: string;
  canonicalUrl: string;
  notes?: string;
  noteAgentVisible: boolean;
}

export interface PartnerAdministrationStore {
  list(): Promise<PartnerStoredRecord[]>;
  get(id: string): Promise<PartnerStoredRecord | undefined>;
  create(input: PartnerStoreCreateInput): Promise<PartnerStoredRecord>;
  update(
    id: string,
    expectedVersion: string,
    input: PartnerStoreUpdateInput,
  ): Promise<
    | { success: true; record: PartnerStoredRecord }
    | { success: false; current: PartnerStoredRecord }
  >;
  delete(
    id: string,
    expectedVersion: string,
  ): Promise<
    | { success: true }
    | { success: false; current: PartnerStoredRecord }
  >;
}

export interface AuditedPartnerAdministrationStore {
  list(): Promise<PartnerStoredRecord[]>;
  get(id: string): Promise<PartnerStoredRecord | undefined>;
  create(
    input: PartnerStoreCreateInput,
    adminAction: PartnerStoreAdminAction,
  ): Promise<PartnerStoredRecord>;
  update(
    id: string,
    expectedVersion: string,
    input: PartnerStoreUpdateInput,
    adminAction: PartnerStoreAdminAction,
  ): Promise<
    | { success: true; record: PartnerStoredRecord }
    | { success: false; current: PartnerStoredRecord }
  >;
  delete(
    id: string,
    expectedVersion: string,
    adminAction: PartnerStoreAdminAction,
  ): Promise<
    | { success: true }
    | { success: false; current: PartnerStoredRecord }
  >;
}

export class PartnerStoreConflictError extends Error {
  constructor(readonly field: "name" | "url") {
    super(`Partner ${field} already exists.`);
    this.name = "PartnerStoreConflictError";
  }
}

export interface PartnerDraftInput {
  name: string;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"] | "";
  url?: string;
  notes?: string;
  logo?: PartnerLogoPayload | null;
}

export interface PartnerPatch {
  name?: string;
  type?: PartnerRecord["type"];
  tier?: PartnerRecord["tier"] | "" | null;
  url?: string | null;
  notes?: string | null;
  logo?: PartnerLogoPayload | null;
}

export interface PartnerAdminSnapshot {
  id: string;
  name: string;
  published: boolean;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logo: string;
  url?: string;
  notes?: string;
  noteAgentVisible: boolean;
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface PartnerPublicationIssue {
  field: "name" | "type" | "tier" | "logo" | "url";
  message: string;
}

export interface PartnerPublicationReadiness {
  ready: boolean;
  issues: PartnerPublicationIssue[];
}

export interface PartnerWarning {
  kind: "similar_name" | "shared_host";
  partner: Pick<PartnerAdminSnapshot, "id" | "name" | "published">;
  message: string;
}

export interface PartnerAdminListItem {
  partner: PartnerAdminSnapshot;
  publication: PartnerPublicationReadiness;
}

export interface PartnerAdminHistoryItem {
  id: string;
  actorUserId: string;
  source: AdminActionSource;
  operationKind: string;
  targetId?: string;
  operationId: string;
  status: AdminActionRecord["status"];
  beforeSummary: AdminActionValue;
  afterSummary: AdminActionValue;
  failure?: { code: string; message: string; metadata?: AdminActionValue };
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerAppliedAdminAction {
  id: string;
  operationId: string;
  operationKind: string;
  status: "applied";
  replayed: boolean;
}

export interface PartnerUnresolvedAdminAction {
  id: string;
  operationId: string;
  operationKind: string;
  status: "pending" | "applied" | "failed";
}

export type PartnerAdministrationResult<T> =
  | { success: true; data: T; action: PartnerAppliedAdminAction }
  | { success: false; code: "validation"; error: string }
  | { success: false; code: "not_found"; error: string }
  | {
      success: false;
      code: "stale";
      error: string;
      current: PartnerAdminSnapshot;
    }
  | {
      success: false;
      code: "publication_not_ready";
      error: string;
      current: PartnerAdminSnapshot;
      publication: PartnerPublicationReadiness;
    }
  | {
      success: false;
      code: "duplicate";
      field: "name" | "url";
      error: string;
      current: PartnerAdminSnapshot;
    }
  | {
      success: false;
      code: "operation_pending";
      error: string;
      action: PartnerUnresolvedAdminAction;
    }
  | {
      success: false;
      code: "operation_mismatch";
      error: string;
      action: PartnerUnresolvedAdminAction;
    }
  | {
      success: false;
      code: "operation_failed";
      error: string;
      action: PartnerUnresolvedAdminAction;
    };

type PartnerDomainResult<T> =
  | { success: true; data: T }
  | { success: false; code: "validation"; error: string }
  | { success: false; code: "not_found"; error: string }
  | {
      success: false;
      code: "stale";
      error: string;
      current: PartnerAdminSnapshot;
    }
  | {
      success: false;
      code: "publication_not_ready";
      error: string;
      current: PartnerAdminSnapshot;
      publication: PartnerPublicationReadiness;
    }
  | {
      success: false;
      code: "duplicate";
      field: "name" | "url";
      error: string;
      current: PartnerAdminSnapshot;
    };

function snapshot(
  record: PartnerStoredRecord,
  actor: PartnerAdministrationActor,
): PartnerAdminSnapshot {
  return {
    id: record.id,
    name: record.name,
    published: record.published,
    type: record.type,
    tier: record.tier,
    logo: record.logo,
    url: record.url,
    notes: actor === "human_admin" || record.noteAgentVisible ? record.notes : undefined,
    noteAgentVisible: record.noteAgentVisible,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

function publicationReadiness(record: PartnerStoredRecord): PartnerPublicationReadiness {
  const issues: PartnerPublicationIssue[] = [];
  if (!record.name.trim()) {
    issues.push({ field: "name", message: "Add a Partner name before publishing." });
  }
  if (!PARTNER_TYPES.includes(record.type)) {
    issues.push({ field: "type", message: "Choose a valid Partner classification." });
  }
  if (record.type === "sponsor" && (!record.tier || !PARTNER_TIERS.includes(record.tier))) {
    issues.push({ field: "tier", message: "Choose one valid Sponsor tier before publishing." });
  }
  if (record.type !== "sponsor" && record.tier) {
    issues.push({ field: "tier", message: "Remove the Sponsor tier from this Partner." });
  }
  if (!record.logo || !record.logoUploadedByHuman) {
    issues.push({
      field: "logo",
      message: "Upload an official Partner logo before publishing.",
    });
  }
  if (!normalizePartnerUrl(record.url).success) {
    issues.push({ field: "url", message: "Fix or clear the Partner URL before publishing." });
  }
  return { ready: issues.length === 0, issues };
}

function normalizeIpv6Host(value: string): string | undefined {
  const sides = value.toLowerCase().split("::");
  if (sides.length > 2) return undefined;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  if (sides.length === 1 && groups.length !== 8) return undefined;
  if (sides.length === 2 && groups.length >= 8) return undefined;
  const expanded = [
    ...left,
    ...Array.from({ length: 8 - groups.length }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16).toString(16));

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < expanded.length;) {
    if (expanded[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < expanded.length && expanded[end] === "0") end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return expanded.join(":");
  const before = expanded.slice(0, bestStart).join(":");
  const after = expanded.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

function removeUrlDotSegments(path: string): string {
  const output: string[] = [];
  const segments = path.split("/");
  const lastSegment = segments.at(-1)?.toLowerCase().replace(/%2e/g, ".");
  const trailingSlash = path.endsWith("/") || lastSegment === "." || lastSegment === "..";
  for (const segment of segments) {
    const dot = segment.toLowerCase().replace(/%2e/g, ".");
    if (dot === ".") continue;
    if (dot === "..") {
      if (output.length > 1) output.pop();
      continue;
    }
    output.push(segment);
  }
  let normalized = output.join("/") || "/";
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (trailingSlash && !normalized.endsWith("/")) normalized += "/";
  return normalized;
}

function normalizePercentEncoding(value: string): string | undefined {
  if (/%(?![0-9a-f]{2})/i.test(value)) return undefined;
  return value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z0-9\-._~]$/i.test(character) ? character : `%${hex.toUpperCase()}`;
  });
}

function normalizeDomainHost(value: string): string | undefined {
  if (/^[0-9.]+$/.test(value)) {
    const groups = value.split(".");
    if (groups.length !== 4 || groups.some((group) => !/^\d{1,3}$/.test(group))) {
      return undefined;
    }
    const numbers = groups.map(Number);
    return numbers.some((group) => group > 255) ? undefined : numbers.join(".");
  }
  const labels = value.split(".");
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    )
  ) {
    return undefined;
  }
  return value.toLowerCase();
}

function canonicalPartnerUrl(value: string): string | undefined {
  if (/[^\x21-\x7e]/.test(value) || value.includes("\\")) return undefined;
  const match = /^https:\/\/([^/?#]+)([^#]*)?(?:#.*)?$/i.exec(value);
  if (!match || match[1].includes("@")) return undefined;
  let authority = match[1].toLowerCase();
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 2) return undefined;
    const host = normalizeIpv6Host(authority.slice(1, close));
    if (!host) return undefined;
    const remainder = authority.slice(close + 1);
    if (remainder && !/^:\d+$/.test(remainder)) return undefined;
    const requestedPort = remainder ? Number(remainder.slice(1)) : undefined;
    if (requestedPort !== undefined && requestedPort > 65535) return undefined;
    authority = `[${host}]${requestedPort !== undefined && requestedPort !== 443 ? `:${requestedPort}` : ""}`;
  } else {
    const colon = authority.lastIndexOf(":");
    let port = "";
    let hostnameValue = authority;
    if (colon >= 0) {
      const requestedPort = authority.slice(colon + 1);
      if (
        authority.indexOf(":") !== colon ||
        !/^\d+$/.test(requestedPort) ||
        Number(requestedPort) > 65535
      ) {
        return undefined;
      }
      hostnameValue = authority.slice(0, colon);
      const portNumber = Number(requestedPort);
      if (portNumber !== 443) port = String(portNumber);
    }
    const hostname = normalizeDomainHost(hostnameValue);
    if (!hostname) return undefined;
    authority = `${hostname}${port ? `:${port}` : ""}`;
  }

  const suffix = match[2] || "/";
  const queryStart = suffix.indexOf("?");
  const path = normalizePercentEncoding(queryStart >= 0 ? suffix.slice(0, queryStart) : suffix);
  const query = normalizePercentEncoding(queryStart >= 0 ? suffix.slice(queryStart) : "");
  if (path === undefined || query === undefined) return undefined;
  return `https://${authority}${removeUrlDotSegments(path || "/")}${query}`;
}

function normalizePartnerUrl(value?: string):
  | { success: true; url?: string; canonicalUrl: string }
  | { success: false } {
  const url = value?.trim();
  if (!url) return { success: true, url: undefined, canonicalUrl: "" };
  const canonicalUrl = canonicalPartnerUrl(url);
  return canonicalUrl ? { success: true, url, canonicalUrl } : { success: false };
}

function canonicalHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function normalizePartnerName(value: string): { name: string; identity: string } {
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return { name, identity: name.toLocaleLowerCase("en-US") };
}

function validatePartnerLogo(logo?: PartnerLogoPayload | null): string | undefined {
  if (!logo) return undefined;
  if (!logo.name.trim() || logo.name.length > 255) return "Logo filename must be 255 characters or shorter.";
  if (!logo.data.length) return "Logo file is empty.";
  if (logo.data.length > PARTNER_LOGO_MAX_BYTES) return "Logo must be 5 MB or smaller.";
  if (!PARTNER_LOGO_TYPES.includes(logo.type)) {
    return "Logo must be SVG, PNG, JPEG, WebP, or AVIF.";
  }
  return undefined;
}

function duplicateResult(
  field: "name" | "url",
  record: PartnerStoredRecord,
  actor: PartnerAdministrationActor,
): PartnerDomainResult<never> {
  return {
    success: false,
    code: "duplicate",
    field,
    error:
      field === "name"
        ? "A Partner with this normalized name already exists."
        : "A Partner with this canonical URL already exists.",
    current: snapshot(record, actor),
  };
}

function staleResult(
  record: PartnerStoredRecord,
  actor: PartnerAdministrationActor,
): PartnerDomainResult<never> {
  return {
    success: false,
    code: "stale",
    error: "This Partner changed after it was loaded. Review the current values and try again.",
    current: snapshot(record, actor),
  };
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function namesAreSimilar(left: string, right: string): boolean {
  const longest = Math.max(left.length, right.length);
  return longest >= 5 && 1 - editDistance(left, right) / longest >= 0.8;
}

function warningPartner(record: PartnerStoredRecord): PartnerWarning["partner"] {
  return { id: record.id, name: record.name.slice(0, 200), published: record.published };
}

function warningMessage(value: string): string {
  return value.slice(0, 500);
}

function similarityWarnings(
  existing: PartnerStoredRecord[],
  normalizedName: string,
  canonicalUrl: string,
): PartnerWarning[] {
  const warnings: PartnerWarning[] = [];
  for (const record of existing) {
    if (namesAreSimilar(normalizedName, record.normalizedName)) {
      warnings.push({
        kind: "similar_name",
        partner: warningPartner(record),
        message: warningMessage(`The name is similar to existing Partner "${record.name.slice(0, 200)}".`),
      });
      if (warnings.length === 3) return warnings;
    }
  }
  if (!canonicalUrl) return warnings;
  const hostname = canonicalHostname(canonicalUrl);
  if (!hostname) return warnings;
  for (const record of existing) {
    if (record.canonicalUrl && canonicalHostname(record.canonicalUrl) === hostname) {
      warnings.push({
        kind: "shared_host",
        partner: warningPartner(record),
        message: warningMessage(`The URL shares ${hostname} with existing Partner "${record.name.slice(0, 200)}".`),
      });
      if (warnings.length === 3) return warnings;
    }
  }
  return warnings;
}

const PARTNER_PATCH_FIELDS = new Set(["name", "type", "tier", "url", "notes", "logo"]);

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

class PartnerAdministrationDomain {
  constructor(
    private readonly store: PartnerAdministrationStore,
    private readonly actor: PartnerAdministrationActor,
  ) {}

  async listPartners(): Promise<PartnerAdminListItem[]> {
    const records = await this.store.list();
    return records
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map((record) => ({
        partner: snapshot(record, this.actor),
        publication: publicationReadiness(record),
      }));
  }

  async getPartner(id: string): Promise<PartnerAdminListItem | undefined> {
    const record = await this.store.get(id);
    return record
      ? { partner: snapshot(record, this.actor), publication: publicationReadiness(record) }
      : undefined;
  }

  async createDraft(
    input: PartnerDraftInput,
  ): Promise<PartnerDomainResult<{
    partner: PartnerAdminSnapshot;
    warnings: PartnerWarning[];
    publication: PartnerPublicationReadiness;
  }>> {
    const { name, identity: normalizedName } = normalizePartnerName(input.name);
    if (!name) {
      return { success: false, code: "validation", error: "Partner name is required." };
    }
    if (name.length > 200) {
      return { success: false, code: "validation", error: "Partner name must be 200 characters or shorter." };
    }
    if (!PARTNER_TYPES.includes(input.type)) {
      return {
        success: false,
        code: "validation",
        error: "Choose a valid Partner classification.",
      };
    }
    if (input.tier && !PARTNER_TIERS.includes(input.tier)) {
      return { success: false, code: "validation", error: "Choose a valid Sponsor tier." };
    }
    if (input.type === "sponsor" && !input.tier) {
      return { success: false, code: "validation", error: "Choose a Sponsor tier." };
    }
    if (input.logo && this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can upload an official Partner logo.",
      };
    }
    const logoError = validatePartnerLogo(input.logo);
    if (logoError) return { success: false, code: "validation", error: logoError };
    if ((input.url?.trim().length || 0) > 2_000) {
      return { success: false, code: "validation", error: "Partner URL must be 2,000 characters or shorter." };
    }
    const normalizedUrl = normalizePartnerUrl(input.url);
    if (!normalizedUrl.success) {
      return {
        success: false,
        code: "validation",
        error: "Partner URL must be an absolute HTTPS URL.",
      };
    }

    const existing = await this.store.list();
    const duplicateName = existing.find((record) => record.normalizedName === normalizedName);
    if (duplicateName) return duplicateResult("name", duplicateName, this.actor);
    const duplicateUrl = normalizedUrl.canonicalUrl
      ? existing.find((record) => record.canonicalUrl === normalizedUrl.canonicalUrl)
      : undefined;
    if (duplicateUrl) return duplicateResult("url", duplicateUrl, this.actor);

    let record: PartnerStoredRecord;
    try {
      record = await this.store.create({
        name,
        normalizedName,
        published: false,
        type: input.type,
        tier: input.type === "sponsor" ? input.tier || undefined : undefined,
        logo: input.logo || undefined,
        logoUploadedByHuman: Boolean(input.logo),
        url: normalizedUrl.url,
        canonicalUrl: normalizedUrl.canonicalUrl,
        notes: input.notes?.trim() || undefined,
        noteAgentVisible: false,
      });
    } catch (error) {
      if (!(error instanceof PartnerStoreConflictError)) throw error;
      const raced = (await this.store.list()).find((candidate) =>
        error.field === "name"
          ? candidate.normalizedName === normalizedName
          : candidate.canonicalUrl === normalizedUrl.canonicalUrl,
      );
      if (!raced) throw error;
      return duplicateResult(error.field, raced, this.actor);
    }

    return {
      success: true,
      data: {
        partner: snapshot(record, this.actor),
        warnings: similarityWarnings(existing, normalizedName, normalizedUrl.canonicalUrl),
        publication: publicationReadiness(record),
      },
    };
  }

  async updatePartner(
    id: string,
    expectedConcurrencyValue: string,
    patch: PartnerPatch,
    concurrencyField: "version" | "updated_at" = "version",
  ): Promise<PartnerDomainResult<{
    partner: PartnerAdminSnapshot;
    warnings: PartnerWarning[];
    publication: PartnerPublicationReadiness;
  }>> {
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      return { success: false, code: "validation", error: "Partner patch is empty." };
    }
    if (keys.some((key) => !PARTNER_PATCH_FIELDS.has(key))) {
      return {
        success: false,
        code: "validation",
        error: "Partner patch contains fields that cannot be changed.",
      };
    }
    if (hasOwn(patch, "logo") && this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can upload or remove an official Partner logo.",
      };
    }

    const current = await this.store.get(id);
    if (!current) {
      return { success: false, code: "not_found", error: "Partner was not found." };
    }
    if (current.published && this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can edit a Published Partner.",
      };
    }
    const currentValue = concurrencyField === "version" ? current.version : current.updatedAt;
    if (!expectedConcurrencyValue || currentValue !== expectedConcurrencyValue) {
      return {
        success: false,
        code: "stale",
        error: "This Partner changed after it was loaded. Review the current values and try again.",
        current: snapshot(current, this.actor),
      };
    }

    const normalizedName = hasOwn(patch, "name")
      ? normalizePartnerName(patch.name || "")
      : { name: current.name, identity: current.normalizedName };
    if (!normalizedName.name) {
      return { success: false, code: "validation", error: "Partner name is required." };
    }
    if (normalizedName.name.length > 200) {
      return { success: false, code: "validation", error: "Partner name must be 200 characters or shorter." };
    }
    const type = hasOwn(patch, "type") ? patch.type : current.type;
    if (!type || !PARTNER_TYPES.includes(type)) {
      return {
        success: false,
        code: "validation",
        error: "Choose a valid Partner classification.",
      };
    }
    const requestedTier = hasOwn(patch, "tier") ? patch.tier || undefined : current.tier;
    if (requestedTier && !PARTNER_TIERS.includes(requestedTier)) {
      return { success: false, code: "validation", error: "Choose a valid Sponsor tier." };
    }
    const tier = type === "sponsor" ? requestedTier : undefined;
    if (type === "sponsor" && !tier) {
      return { success: false, code: "validation", error: "Choose a Sponsor tier." };
    }
    const requestedUrl = hasOwn(patch, "url") ? patch.url || undefined : current.url;
    if ((requestedUrl?.trim().length || 0) > 2_000) {
      return { success: false, code: "validation", error: "Partner URL must be 2,000 characters or shorter." };
    }
    const normalizedUrl = normalizePartnerUrl(requestedUrl);
    if (!normalizedUrl.success) {
      return {
        success: false,
        code: "validation",
        error: "Partner URL must be an absolute HTTPS URL.",
      };
    }
    const logoError = hasOwn(patch, "logo") ? validatePartnerLogo(patch.logo) : undefined;
    if (logoError) return { success: false, code: "validation", error: logoError };

    const existing = (await this.store.list()).filter((record) => record.id !== id);
    const duplicateName = existing.find(
      (record) => record.normalizedName === normalizedName.identity,
    );
    if (duplicateName) return duplicateResult("name", duplicateName, this.actor);
    const duplicateUrl = normalizedUrl.canonicalUrl
      ? existing.find((record) => record.canonicalUrl === normalizedUrl.canonicalUrl)
      : undefined;
    if (duplicateUrl) return duplicateResult("url", duplicateUrl, this.actor);

    const notes = hasOwn(patch, "notes") ? patch.notes?.trim() || undefined : current.notes;
    const candidate: PartnerStoredRecord = {
      ...current,
      name: normalizedName.name,
      normalizedName: normalizedName.identity,
      type,
      tier,
      logo:
        patch.logo === undefined
          ? current.logo
          : patch.logo === null
            ? ""
            : patch.logo.name,
      logoUploadedByHuman: hasOwn(patch, "logo")
        ? Boolean(patch.logo)
        : current.logoUploadedByHuman,
      url: normalizedUrl.url,
      canonicalUrl: normalizedUrl.canonicalUrl,
      notes,
      noteAgentVisible: hasOwn(patch, "notes") ? false : current.noteAgentVisible,
    };
    const candidatePublication = publicationReadiness(candidate);
    if (current.published && !candidatePublication.ready) {
      return {
        success: false,
        code: "publication_not_ready",
        error: "Published Partners must remain ready for public display.",
        current: snapshot(current, this.actor),
        publication: candidatePublication,
      };
    }
    let record: PartnerStoredRecord;
    try {
      const stored = await this.store.update(id, current.version, {
        name: normalizedName.name,
        normalizedName: normalizedName.identity,
        published: current.published,
        type,
        tier,
        logo: hasOwn(patch, "logo") ? patch.logo : undefined,
        logoUploadedByHuman: hasOwn(patch, "logo")
          ? Boolean(patch.logo)
          : current.logoUploadedByHuman,
        url: normalizedUrl.url,
        canonicalUrl: normalizedUrl.canonicalUrl,
        notes,
        noteAgentVisible: hasOwn(patch, "notes") ? false : current.noteAgentVisible,
      });
      if (!stored.success) return staleResult(stored.current, this.actor);
      record = stored.record;
    } catch (error) {
      if (!(error instanceof PartnerStoreConflictError)) throw error;
      const raced = (await this.store.list()).find((candidate) =>
        error.field === "name"
          ? candidate.normalizedName === normalizedName.identity
          : candidate.canonicalUrl === normalizedUrl.canonicalUrl,
      );
      if (!raced) throw error;
      return duplicateResult(error.field, raced, this.actor);
    }

    return {
      success: true,
      data: {
        partner: snapshot(record, this.actor),
        warnings: similarityWarnings(
          existing,
          normalizedName.identity,
          normalizedUrl.canonicalUrl,
        ),
        publication: publicationReadiness(record),
      },
    };
  }

  async setNoteApproval(
    id: string,
    expectedVersion: string,
    approved: boolean,
  ): Promise<PartnerDomainResult<{
    partner: PartnerAdminSnapshot;
    warnings: PartnerWarning[];
    publication: PartnerPublicationReadiness;
  }>> {
    if (this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can approve a Partner Note for agent visibility.",
      };
    }
    const current = await this.store.get(id);
    if (!current) {
      return { success: false, code: "not_found", error: "Partner was not found." };
    }
    if (!expectedVersion || current.version !== expectedVersion) {
      return {
        success: false,
        code: "stale",
        error: "This Partner changed after it was loaded. Review the current values and try again.",
        current: snapshot(current, this.actor),
      };
    }
    if (approved && !current.notes) {
      return {
        success: false,
        code: "validation",
        error: "Add a Partner Note before approving agent visibility.",
      };
    }

    const stored = await this.store.update(id, current.version, {
      name: current.name,
      normalizedName: current.normalizedName,
      published: current.published,
      type: current.type,
      tier: current.tier,
      logoUploadedByHuman: current.logoUploadedByHuman,
      url: current.url,
      canonicalUrl: current.canonicalUrl,
      notes: current.notes,
      noteAgentVisible: approved,
    });
    if (!stored.success) return staleResult(stored.current, this.actor);
    const record = stored.record;
    return {
      success: true,
      data: {
        partner: snapshot(record, this.actor),
        warnings: [],
        publication: publicationReadiness(record),
      },
    };
  }

  async setPublication(
    id: string,
    expectedVersion: string,
    published: boolean,
  ): Promise<PartnerDomainResult<{
    partner: PartnerAdminSnapshot;
    warnings: PartnerWarning[];
    publication: PartnerPublicationReadiness;
  }>> {
    if (this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can change Partner publication.",
      };
    }
    const current = await this.store.get(id);
    if (!current) {
      return { success: false, code: "not_found", error: "Partner was not found." };
    }
    if (!expectedVersion || current.version !== expectedVersion) {
      return {
        success: false,
        code: "stale",
        error: "This Partner changed after it was loaded. Review the current values and try again.",
        current: snapshot(current, this.actor),
      };
    }
    const readiness = publicationReadiness(current);
    if (published && !readiness.ready) {
      return {
        success: false,
        code: "publication_not_ready",
        error: "Complete the Partner publication requirements before publishing.",
        current: snapshot(current, this.actor),
        publication: readiness,
      };
    }
    if (current.published === published) {
      return {
        success: true,
        data: { partner: snapshot(current, this.actor), warnings: [], publication: readiness },
      };
    }

    const stored = await this.store.update(id, current.version, {
      name: current.name,
      normalizedName: current.normalizedName,
      published,
      type: current.type,
      tier: current.tier,
      logoUploadedByHuman: current.logoUploadedByHuman,
      url: current.url,
      canonicalUrl: current.canonicalUrl,
      notes: current.notes,
      noteAgentVisible: current.noteAgentVisible,
    });
    if (!stored.success) return staleResult(stored.current, this.actor);
    const record = stored.record;
    return {
      success: true,
      data: {
        partner: snapshot(record, this.actor),
        warnings: [],
        publication: publicationReadiness(record),
      },
    };
  }

  async deletePartner(
    id: string,
    expectedVersion: string,
  ): Promise<PartnerDomainResult<{ id: string }>> {
    if (this.actor !== "human_admin") {
      return {
        success: false,
        code: "validation",
        error: "Only a human admin can delete a Partner.",
      };
    }
    const current = await this.store.get(id);
    if (!current) {
      return { success: false, code: "not_found", error: "Partner was not found." };
    }
    if (!expectedVersion || current.version !== expectedVersion) {
      return {
        success: false,
        code: "stale",
        error: "This Partner changed after it was loaded. Review the current values and try again.",
        current: snapshot(current, this.actor),
      };
    }
    const deleted = await this.store.delete(id, current.version);
    if (!deleted.success) return staleResult(deleted.current, this.actor);
    return { success: true, data: { id } };
  }
}

type PartnerMutationData =
  | {
      partner: PartnerAdminSnapshot;
      warnings: PartnerWarning[];
      publication: PartnerPublicationReadiness;
    }
  | { id: string };

function hashActionContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function actionNote(value?: string | null): AdminActionValue {
  const normalized = value?.trim() || "";
  return normalized
    ? { present: true, length: normalized.length, fingerprint: hashActionContent(normalized) }
    : { present: false };
}

function actionLogo(value?: PartnerLogoPayload | null): AdminActionValue {
  if (value === null) return { present: false };
  if (!value) return { changed: false };
  return {
    present: true,
    name: value.name,
    mediaType: value.type,
    bytes: value.data.length,
    fingerprint: hashActionContent(Buffer.from(value.data).toString("base64")),
  };
}

function safePartnerSummary(
  partner: Pick<
    PartnerStoredRecord,
    | "id"
    | "name"
    | "published"
    | "type"
    | "tier"
    | "logo"
    | "url"
    | "notes"
    | "noteAgentVisible"
  >,
  changedFields: string[] = [],
): AdminActionValue {
  return {
    id: partner.id,
    name: partner.name,
    published: partner.published,
    type: partner.type,
    tier: partner.tier || null,
    logoPresent: Boolean(partner.logo),
    urlPresent: Boolean(partner.url),
    notePresent: Boolean(partner.notes),
    noteAgentVisible: partner.noteAgentVisible,
    changedFields,
  };
}

function safeCreateSummary(input: PartnerStoreCreateInput): AdminActionValue {
  return {
    name: input.name,
    published: false,
    type: input.type,
    tier: input.tier || null,
    logoPresent: Boolean(input.logo),
    urlPresent: Boolean(input.url),
    notePresent: Boolean(input.notes),
    noteAgentVisible: false,
    changedFields: ["created"],
  };
}

function replayPartnerSnapshot(
  partner: Pick<
    PartnerStoredRecord,
    | "id"
    | "name"
    | "published"
    | "type"
    | "tier"
    | "logo"
    | "url"
    | "noteAgentVisible"
    | "createdAt"
    | "updatedAt"
    | "version"
  >,
): Omit<PartnerAdminSnapshot, "notes"> {
  return {
    id: partner.id,
    name: partner.name.slice(0, 200),
    published: partner.published,
    type: partner.type,
    tier: partner.tier,
    logo: partner.logo.slice(0, 255),
    url: partner.url?.slice(0, 2_000),
    noteAgentVisible: partner.noteAgentVisible,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
    version: partner.version,
  };
}

function toAdminActionValue(value: unknown): AdminActionValue {
  return JSON.parse(JSON.stringify(value)) as AdminActionValue;
}

function partnerMutationReplayResult(
  partner: Parameters<typeof replayPartnerSnapshot>[0],
  warnings: PartnerWarning[],
  publication: PartnerPublicationReadiness,
): AdminActionValue {
  return toAdminActionValue({
    kind: "partner_mutation",
    data: {
      partner: replayPartnerSnapshot(partner),
      warnings,
      publication,
    },
  });
}

export function completePartnerMutationAdminAction(
  completion: AdminActionCompletion,
  record: PartnerStoredRecord,
): AdminActionCompletion {
  const afterSummary =
    completion.afterSummary &&
    typeof completion.afterSummary === "object" &&
    !Array.isArray(completion.afterSummary)
      ? { ...completion.afterSummary, id: record.id }
      : completion.afterSummary;
  const replayResult = completion.replayResult;
  let completedReplayResult: AdminActionValue = { kind: "partner_delete", data: { id: record.id } };
  if (
    replayResult &&
    typeof replayResult === "object" &&
    !Array.isArray(replayResult) &&
    replayResult.kind === "partner_mutation" &&
    replayResult.data &&
    typeof replayResult.data === "object" &&
    !Array.isArray(replayResult.data)
  ) {
    completedReplayResult = toAdminActionValue({
      ...replayResult,
      data: {
        ...replayResult.data,
        partner: replayPartnerSnapshot(record),
      },
    });
  }
  return {
    ...completion,
    targetId: record.id,
    afterSummary,
    replayResult: completedReplayResult,
  };
}

function replayResultFromData(data: PartnerMutationData): AdminActionValue {
  if ("id" in data) return { kind: "partner_delete", data: { id: data.id } };
  const { notes: _notes, ...partner } = data.partner;
  return toAdminActionValue({
    kind: "partner_mutation",
    data: {
      partner,
      warnings: data.warnings.slice(0, 3),
      publication: data.publication,
    },
  });
}

function updatedStoredRecord(
  current: PartnerStoredRecord,
  input: PartnerStoreUpdateInput,
): PartnerStoredRecord {
  return {
    ...current,
    name: input.name,
    normalizedName: input.normalizedName,
    published: input.published,
    type: input.type,
    tier: input.tier,
    logo:
      input.logo === undefined
        ? current.logo
        : input.logo === null
          ? ""
          : input.logo.name,
    logoUploadedByHuman: input.logoUploadedByHuman,
    url: input.url,
    canonicalUrl: input.canonicalUrl,
    notes: input.notes,
    noteAgentVisible: input.noteAgentVisible,
  };
}

function operationAction(record: AdminActionRecord, replayed: boolean): PartnerAppliedAdminAction {
  return {
    id: record.id,
    operationId: record.operationId,
    operationKind: record.operationKind,
    status: "applied",
    replayed,
  };
}

function unresolvedAction(record: AdminActionRecord): PartnerUnresolvedAdminAction {
  return {
    id: record.id,
    operationId: record.operationId,
    operationKind: record.operationKind,
    status: record.status,
  };
}

class PartnerAdminActionFlow extends Error {
  constructor(readonly result: PartnerAdministrationResult<never>) {
    super(result.success ? "Partner Admin Action replayed." : result.error);
    this.name = "PartnerAdminActionFlow";
  }
}

export class PartnerAdministration {
  constructor(
    private readonly store: AuditedPartnerAdministrationStore,
    private readonly actor: PartnerAdministrationActorContext,
    private readonly adminActions: AdminActions,
  ) {}

  async listPartners(): Promise<PartnerAdminListItem[]> {
    return new PartnerAdministrationDomain(this.readOnlyStore(), this.actor.mode).listPartners();
  }

  async getPartner(id: string): Promise<PartnerAdminListItem | undefined> {
    return new PartnerAdministrationDomain(this.readOnlyStore(), this.actor.mode).getPartner(id);
  }

  async listHistory(targetId?: string, limit = 50): Promise<PartnerAdminHistoryItem[]> {
    const actions = await this.adminActions.list({ targetCollection: "partners", targetId, limit });
    return actions.map((action) => ({
      id: action.id,
      actorUserId: action.actorUserId,
      source: action.source,
      operationKind: action.operationKind,
      targetId: action.targetId,
      operationId: action.operationId,
      status: action.status,
      beforeSummary: action.beforeSummary,
      afterSummary: action.afterSummary,
      failure: action.failure,
      attemptCount: action.attemptCount,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    }));
  }

  async createDraft(
    input: PartnerDraftInput,
    operationId: string,
  ): Promise<PartnerAdministrationResult<Extract<PartnerMutationData, { partner: unknown }>>> {
    const normalizedName = normalizePartnerName(input.name || "");
    const normalizedUrl = normalizePartnerUrl(input.url);
    return this.runMutation(
      this.request("partner.create", operationId, undefined, {
        name: normalizedName.name,
        normalizedName: normalizedName.identity,
        type: input.type,
        tier: input.type === "sponsor" ? input.tier || null : null,
        url: normalizedUrl.success ? normalizedUrl.canonicalUrl : input.url?.trim() || null,
        urlValue: input.url?.trim() || null,
        partnerNote: actionNote(input.notes),
        logo: actionLogo(input.logo || undefined),
      }),
      (domain) => domain.createDraft(input),
    );
  }

  async updatePartner(
    id: string,
    expectedVersion: string,
    patch: PartnerPatch,
    operationId: string,
  ): Promise<PartnerAdministrationResult<Extract<PartnerMutationData, { partner: unknown }>>> {
    const normalizedPatch = this.normalizedPatch(patch);
    return this.runMutation(
      this.request("partner.patch", operationId, id, {
        id,
        expectedVersion,
        patch: normalizedPatch,
      }),
      (domain) => domain.updatePartner(id, expectedVersion, patch),
    );
  }

  async updatePartnerDraft(
    id: string,
    expectedUpdatedAt: string,
    patch: PartnerPatch,
    operationId: string,
  ): Promise<PartnerAdministrationResult<Extract<PartnerMutationData, { partner: unknown }>>> {
    const normalizedPatch = this.normalizedPatch(patch);
    return this.runMutation(
      this.request("partner.patch", operationId, id, {
        id,
        expectedUpdatedAt,
        patch: normalizedPatch,
      }),
      (domain) => domain.updatePartner(id, expectedUpdatedAt, patch, "updated_at"),
    );
  }

  async setNoteApproval(
    id: string,
    expectedVersion: string,
    approved: boolean,
    operationId: string,
  ): Promise<PartnerAdministrationResult<Extract<PartnerMutationData, { partner: unknown }>>> {
    return this.runMutation(
      this.request("partner.note_approval", operationId, id, { id, expectedVersion, approved }),
      (domain) => domain.setNoteApproval(id, expectedVersion, approved),
    );
  }

  async setPublication(
    id: string,
    expectedVersion: string,
    published: boolean,
    operationId: string,
  ): Promise<PartnerAdministrationResult<Extract<PartnerMutationData, { partner: unknown }>>> {
    return this.runMutation(
      this.request(published ? "partner.publish" : "partner.unpublish", operationId, id, {
        id,
        expectedVersion,
        published,
      }),
      (domain) => domain.setPublication(id, expectedVersion, published),
    );
  }

  async deletePartner(
    id: string,
    expectedVersion: string,
    operationId: string,
  ): Promise<PartnerAdministrationResult<{ id: string }>> {
    return this.runMutation(
      this.request("partner.delete", operationId, id, { id, expectedVersion }),
      (domain) => domain.deletePartner(id, expectedVersion),
    );
  }

  private readOnlyStore(): PartnerAdministrationStore {
    return {
      list: () => this.store.list(),
      get: (id) => this.store.get(id),
      create: () => Promise.reject(new Error("Partner mutation requires an Admin Action.")),
      update: () => Promise.reject(new Error("Partner mutation requires an Admin Action.")),
      delete: () => Promise.reject(new Error("Partner mutation requires an Admin Action.")),
    };
  }

  private request(
    operationKind: string,
    operationId: string,
    targetId: string | undefined,
    normalizedInput: AdminActionValue,
  ): AdminActionRequest {
    return {
      actorUserId: this.actor.userId,
      mcpTokenId: this.actor.mcpTokenId,
      source: this.actor.source,
      operationKind,
      targetCollection: "partners",
      targetId,
      operationId,
      normalizedInput,
    };
  }

  private normalizedPatch(patch: PartnerPatch): Record<string, AdminActionValue> {
    const normalizedPatch: Record<string, AdminActionValue> = {};
    for (const key of Object.keys(patch).sort()) {
      if (key === "name") {
        const normalizedName = normalizePartnerName(patch.name || "");
        normalizedPatch.name = normalizedName.name;
        normalizedPatch.normalizedName = normalizedName.identity;
      } else if (key === "url") {
        const normalized = normalizePartnerUrl(patch.url || undefined);
        normalizedPatch.url = normalized.success
          ? normalized.canonicalUrl || null
          : patch.url?.trim() || null;
        normalizedPatch.urlValue = patch.url?.trim() || null;
      } else if (key === "notes") normalizedPatch.partnerNote = actionNote(patch.notes);
      else if (key === "logo") normalizedPatch.logo = actionLogo(patch.logo);
      else if (key === "type") normalizedPatch.type = patch.type || null;
      else if (key === "tier") normalizedPatch.tier = patch.tier || null;
      else normalizedPatch[key] = null;
    }
    if (hasOwn(patch, "type") && patch.type !== "sponsor") normalizedPatch.tier = null;
    return normalizedPatch;
  }

  private async replay<T>(
    action: AdminActionRecord,
    replayed = true,
  ): Promise<PartnerAdministrationResult<T>> {
    const replayResult = action.replayResult;
    if (
      replayResult &&
      typeof replayResult === "object" &&
      !Array.isArray(replayResult) &&
      replayResult.data &&
      typeof replayResult.data === "object" &&
      !Array.isArray(replayResult.data)
    ) {
      return {
        success: true,
        data: replayResult.data as T,
        action: operationAction(action, replayed),
      };
    }
    return {
      success: false,
      code: "operation_failed",
      error: "The applied Partner operation has no replayable result.",
      action: unresolvedAction(action),
    };
  }

  private async existingAction<T>(
    request: AdminActionRequest,
  ): Promise<{ handle?: AdminActionHandle; result?: PartnerAdministrationResult<T> }> {
    const inspected = await this.adminActions.inspect(request);
    if (inspected.outcome === "new") return {};
    if (inspected.outcome === "retryable") {
      const reclaimed = await this.adminActions.start(request);
      if (reclaimed.outcome === "started") return { handle: reclaimed.handle };
      if (reclaimed.outcome === "replayed") {
        return { result: await this.replay<T>(reclaimed.action) };
      }
      if (reclaimed.outcome === "pending") {
        return {
          result: {
            success: false,
            code: "operation_pending",
            error: "This Partner operation is already in progress.",
            action: unresolvedAction(reclaimed.action),
          },
        };
      }
      return {
        result: {
          success: false,
          code: "operation_mismatch",
          error: "This operation ID is already bound to different Partner input.",
          action: unresolvedAction(reclaimed.action),
        },
      };
    }
    if (inspected.outcome === "replayed") {
      return { result: await this.replay<T>(inspected.action) };
    }
    if (inspected.outcome === "pending") {
      return {
        result: {
          success: false,
          code: "operation_pending",
          error: "This Partner operation is already in progress.",
          action: unresolvedAction(inspected.action),
        },
      };
    }
    return {
      result: {
        success: false,
        code: "operation_mismatch",
        error: "This operation ID is already bound to different Partner input.",
        action: unresolvedAction(inspected.action),
      },
    };
  }

  private async runMutation<T extends PartnerMutationData>(
    request: AdminActionRequest,
    mutate: (domain: PartnerAdministrationDomain) => Promise<PartnerDomainResult<T>>,
  ): Promise<PartnerAdministrationResult<T>> {
    const existing = await this.existingAction<T>(request);
    if (existing.result) return existing.result;

    let activeHandle = existing.handle;
    const reserve = async (completion: AdminActionCompletion): Promise<PartnerStoreAdminAction> => {
      if (!activeHandle) {
        const started = await this.adminActions.start(request, {
          beforeSummary: completion.beforeSummary,
          afterSummary: completion.afterSummary,
        });
        if (started.outcome === "replayed") throw new PartnerAdminActionFlow(await this.replay(started.action));
        if (started.outcome === "pending") {
          throw new PartnerAdminActionFlow({
            success: false,
            code: "operation_pending",
            error: "This Partner operation is already in progress.",
            action: unresolvedAction(started.action),
          });
        }
        if (started.outcome === "mismatch") {
          throw new PartnerAdminActionFlow({
            success: false,
            code: "operation_mismatch",
            error: "This operation ID is already bound to different Partner input.",
            action: unresolvedAction(started.action),
          });
        }
        activeHandle = started.handle;
      }
      const handle = activeHandle;
      return {
        handle,
        operationKind: request.operationKind,
        targetId: request.targetId,
        normalizedInput: request.normalizedInput,
        completion,
        complete: (value) => this.adminActions.complete(handle, value),
        isApplied: async () => (await this.adminActions.inspect(request)).outcome === "replayed",
      };
    };

    const auditedStore: PartnerAdministrationStore = {
      list: () => this.store.list(),
      get: (id) => this.store.get(id),
      create: async (input) => {
        const existing = await this.store.list();
        const timestamp = "";
        const candidate: PartnerStoredRecord = {
          id: "",
          name: input.name,
          normalizedName: input.normalizedName,
          published: false,
          type: input.type,
          tier: input.tier,
          logo: input.logo?.name || "",
          logoUploadedByHuman: input.logoUploadedByHuman,
          url: input.url,
          canonicalUrl: input.canonicalUrl,
          notes: input.notes,
          noteAgentVisible: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: timestamp,
        };
        const action = await reserve({
          beforeSummary: null,
          afterSummary: safeCreateSummary(input),
          replayResult: partnerMutationReplayResult(
            candidate,
            similarityWarnings(existing, input.normalizedName, input.canonicalUrl),
            publicationReadiness(candidate),
          ),
        });
        return this.store.create(input, action);
      },
      update: async (id, expectedVersion, input) => {
        const current = await this.store.get(id);
        const changedFields =
          request.operationKind === "partner.patch"
            ? Object.keys((request.normalizedInput as { patch?: Record<string, AdminActionValue> }).patch || {})
                .filter((field) => field !== "normalizedName" && field !== "urlValue")
                .map((field) => (field === "partnerNote" ? "partnerNote" : field))
            : [request.operationKind.replace("partner.", "")];
        const candidate = current ? updatedStoredRecord(current, input) : undefined;
        const existing = request.operationKind === "partner.patch"
          ? (await this.store.list()).filter((record) => record.id !== id)
          : [];
        const action = await reserve({
          targetId: id,
          beforeSummary: current ? safePartnerSummary(current) : null,
          afterSummary: candidate ? safePartnerSummary(candidate, changedFields) : null,
          replayResult: candidate
            ? partnerMutationReplayResult(
                candidate,
                request.operationKind === "partner.patch"
                  ? similarityWarnings(existing, candidate.normalizedName, candidate.canonicalUrl)
                  : [],
                publicationReadiness(candidate),
              )
            : { kind: "partner_mutation", data: null },
        });
        return this.store.update(id, expectedVersion, input, action);
      },
      delete: async (id, expectedVersion) => {
        const current = await this.store.get(id);
        const action = await reserve({
          targetId: id,
          beforeSummary: current ? safePartnerSummary(current, ["deleted"]) : null,
          afterSummary: null,
          replayResult: { kind: "partner_delete", data: { id } },
        });
        return this.store.delete(id, expectedVersion, action);
      },
    };

    try {
      const domain = new PartnerAdministrationDomain(auditedStore, this.actor.mode);
      const result = await mutate(domain);
      if (!result.success) {
        if (activeHandle) {
          await this.adminActions.fail(activeHandle, {
            code: result.code,
            message: "The Partner operation was rejected without changing the Partner.",
          });
        }
        return result;
      }

      let applied = await this.adminActions.inspect(request);
      if (applied.outcome === "new" || applied.outcome === "retryable") {
        const partner = "partner" in result.data ? result.data.partner : undefined;
        const started = await this.adminActions.start(request);
        if (started.outcome !== "started") {
          if (started.outcome === "replayed") return this.replay<T>(started.action);
          throw new PartnerAdminActionFlow({
            success: false,
            code: started.outcome === "pending" ? "operation_pending" : "operation_mismatch",
            error:
              started.outcome === "pending"
                ? "This Partner operation is already in progress."
                : "This operation ID is already bound to different Partner input.",
            action: unresolvedAction(started.action),
          });
        }
        const completed = await this.adminActions.complete(started.handle, {
          targetId: partner?.id,
          beforeSummary: partner ? safePartnerSummary(partner) : null,
          afterSummary: partner ? safePartnerSummary(partner) : null,
          replayResult: replayResultFromData(result.data),
        });
        return this.replay<T>(completed, false);
      }
      if (applied.outcome === "replayed") {
        return this.replay<T>(applied.action, false);
      }
      throw new Error("Partner mutation returned before its Admin Action was applied.");
    } catch (error) {
      if (error instanceof PartnerAdminActionFlow) return error.result as PartnerAdministrationResult<T>;
      const inspected = await this.adminActions.inspect(request);
      if (inspected.outcome === "replayed") return this.replay<T>(inspected.action);
      if (activeHandle) {
        console.error("Audited Partner persistence failed", error);
        let failed: AdminActionRecord;
        try {
          failed = await this.adminActions.fail(activeHandle, {
            code: "partner_write_failed",
            message: "Partner persistence failed safely.",
            metadata: { retryable: true },
          });
        } catch (failureError) {
          console.error("Could not mark the Partner Admin Action as failed", failureError);
          const unresolved = await this.adminActions.inspect(request);
          if (unresolved.outcome === "new") throw failureError;
          if (unresolved.outcome === "replayed") return this.replay<T>(unresolved.action);
          failed = unresolved.action;
        }
        return {
          success: false,
          code: "operation_failed",
          error: "The Partner operation failed safely and may be retried with the same operation ID.",
          action: unresolvedAction(failed),
        };
      }
      throw error;
    }
  }
}
