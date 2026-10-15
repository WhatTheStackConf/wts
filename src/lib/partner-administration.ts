import { createHash } from "node:crypto";
import type {
  AdminActionCompletion,
  AdminActionHandle,
  AdminActionRecord,
  AdminActionRequest,
  AdminActionSource,
  AdminActionValue,
} from "~/lib/admin-action-ledger";
import {
  AdminActions,
  containsAdminActionSecretMaterial,
} from "~/lib/admin-action-ledger";
import type { PartnerLogoSurface, PartnerRecord } from "~/lib/pocketbase-types";

export const PARTNER_TYPES = [
  "organizer",
  "sponsor",
  "supporter",
  "community_partner",
  "media",
  "catering",
  "other",
] as const satisfies readonly PartnerRecord["type"][];
export const PARTNER_TIERS = ["platinum", "gold", "silver", "bronze", "bank"] as const;
export const PARTNER_LOGO_SURFACES = ["dark", "light", "mixed"] as const satisfies readonly PartnerLogoSurface[];
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
  logoSurface: PartnerLogoSurface;
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
  logoSurface: PartnerLogoSurface;
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
  logoSurface: PartnerLogoSurface;
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
  logoSurface?: PartnerLogoSurface;
}

export interface PartnerPatch {
  name?: string;
  type?: PartnerRecord["type"];
  tier?: PartnerRecord["tier"] | "" | null;
  url?: string | null;
  notes?: string | null;
  logo?: PartnerLogoPayload | null;
  logoSurface?: PartnerLogoSurface;
}

export interface PartnerAdminSnapshot {
  id: string;
  name: string;
  published: boolean;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logo: string;
  logoSurface: PartnerLogoSurface;
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
  const noteAgentVisible = record.noteAgentVisible && !unsafePartnerText(record.notes);
  return {
    id: record.id,
    name: record.name,
    published: record.published,
    type: record.type,
    tier: record.tier,
    logo: record.logo,
    logoSurface: record.logoSurface,
    url: record.url,
    notes: actor === "human_admin" || noteAgentVisible ? record.notes : undefined,
    noteAgentVisible: actor === "human_admin" ? record.noteAgentVisible : noteAgentVisible,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
  };
}

const PUBLICATION_RULES: Array<{
  issue: PartnerPublicationIssue;
  fails: (record: PartnerStoredRecord) => boolean;
}> = [
  {
    issue: { field: "name", message: "Add a Partner name before publishing." },
    fails: (record) => !record.name.trim(),
  },
  {
    issue: { field: "type", message: "Choose a valid Partner classification." },
    fails: (record) => !PARTNER_TYPES.includes(record.type),
  },
  {
    issue: { field: "tier", message: "Choose one valid Sponsor tier before publishing." },
    fails: (record) =>
      record.type === "sponsor" && (!record.tier || !PARTNER_TIERS.includes(record.tier)),
  },
  {
    issue: { field: "tier", message: "Remove the Sponsor tier from this Partner." },
    fails: (record) => record.type !== "sponsor" && Boolean(record.tier),
  },
  {
    issue: { field: "logo", message: "Upload an official Partner logo before publishing." },
    fails: (record) => !record.logo || !record.logoUploadedByHuman,
  },
  {
    issue: { field: "url", message: "Fix or clear the Partner URL before publishing." },
    fails: (record) => !normalizePartnerUrl(record.url).success,
  },
];

function publicationReadiness(record: PartnerStoredRecord): PartnerPublicationReadiness {
  const issues = PUBLICATION_RULES
    .filter((rule) => rule.fails(record))
    .map((rule) => ({ ...rule.issue }));
  return { ready: issues.length === 0, issues };
}

function expandIpv6Groups(value: string): string[] | undefined {
  const sides = value.toLowerCase().split("::");
  if (sides.length > 2) return undefined;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const groups = [...left, ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  if (sides.length === 1 && groups.length !== 8) return undefined;
  if (sides.length === 2 && groups.length >= 8) return undefined;
  return [
    ...left,
    ...Array.from({ length: 8 - groups.length }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16).toString(16));
}

function longestZeroRun(groups: string[]): { start: number; length: number } {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  return { start: bestStart, length: bestLength };
}

function normalizeIpv6Host(value: string): string | undefined {
  const expanded = expandIpv6Groups(value);
  if (!expanded) return undefined;
  const zeroRun = longestZeroRun(expanded);
  if (zeroRun.start < 0) return expanded.join(":");
  const before = expanded.slice(0, zeroRun.start).join(":");
  const after = expanded.slice(zeroRun.start + zeroRun.length).join(":");
  return `${before}::${after}`;
}

function decodedDotSegment(segment: string): string {
  return segment.toLowerCase().replace(/%2e/g, ".");
}

function resolveDotSegments(segments: string[]): string[] {
  const output: string[] = [];
  for (const segment of segments) {
    const dot = decodedDotSegment(segment);
    if (dot === ".") continue;
    if (dot === "..") {
      if (output.length > 1) output.pop();
      continue;
    }
    output.push(segment);
  }
  return output;
}

function removeUrlDotSegments(path: string): string {
  const segments = path.split("/");
  const lastSegment = segments.at(-1)?.toLowerCase().replace(/%2e/g, ".");
  const trailingSlash = path.endsWith("/") || lastSegment === "." || lastSegment === "..";
  let normalized = resolveDotSegments(segments).join("/") || "/";
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

function portSuffix(port: number | undefined): string {
  return port !== undefined && port !== 443 ? `:${port}` : "";
}

function canonicalIpv6Authority(authority: string): string | undefined {
  const close = authority.indexOf("]");
  if (close < 2) return undefined;
  const host = normalizeIpv6Host(authority.slice(1, close));
  if (!host) return undefined;
  const remainder = authority.slice(close + 1);
  if (remainder && !/^:\d+$/.test(remainder)) return undefined;
  const requestedPort = remainder ? Number(remainder.slice(1)) : undefined;
  if (requestedPort !== undefined && requestedPort > 65535) return undefined;
  return `[${host}]${portSuffix(requestedPort)}`;
}

function splitDomainPort(authority: string): { hostname: string; port?: number } | undefined {
  const colon = authority.lastIndexOf(":");
  if (colon < 0) return { hostname: authority };
  const requestedPort = authority.slice(colon + 1);
  if (
    authority.indexOf(":") !== colon ||
    !/^\d+$/.test(requestedPort) ||
    Number(requestedPort) > 65535
  ) {
    return undefined;
  }
  return { hostname: authority.slice(0, colon), port: Number(requestedPort) };
}

function canonicalDomainAuthority(authority: string): string | undefined {
  const parts = splitDomainPort(authority);
  if (!parts) return undefined;
  const hostname = normalizeDomainHost(parts.hostname);
  if (!hostname) return undefined;
  return `${hostname}${portSuffix(parts.port)}`;
}

function canonicalPathAndQuery(suffix: string): string | undefined {
  const queryStart = suffix.indexOf("?");
  const path = normalizePercentEncoding(queryStart >= 0 ? suffix.slice(0, queryStart) : suffix);
  const query = normalizePercentEncoding(queryStart >= 0 ? suffix.slice(queryStart) : "");
  if (path === undefined || query === undefined) return undefined;
  return `${removeUrlDotSegments(path || "/")}${query}`;
}

function canonicalPartnerUrl(value: string): string | undefined {
  if (/[^\x21-\x7e]/.test(value) || value.includes("\\")) return undefined;
  const match = /^https:\/\/([^/?#]+)([^#]*)?(?:#.*)?$/i.exec(value);
  if (!match || match[1].includes("@")) return undefined;
  const lowered = match[1].toLowerCase();
  const authority = lowered.startsWith("[")
    ? canonicalIpv6Authority(lowered)
    : canonicalDomainAuthority(lowered);
  if (authority === undefined) return undefined;
  const pathAndQuery = canonicalPathAndQuery(match[2] || "/");
  if (pathAndQuery === undefined) return undefined;
  return `https://${authority}${pathAndQuery}`;
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

function unsafePartnerText(value: string | null | undefined): boolean {
  return Boolean(value && containsAdminActionSecretMaterial(value));
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

const SECRET_FIELD_ERROR = "Partner fields cannot contain credentials or secret hashes.";
const CLASSIFICATION_ERROR = "Choose a valid Partner classification.";
const TIER_ERROR = "Choose a valid Sponsor tier.";
const SPONSOR_TIER_REQUIRED_ERROR = "Choose a Sponsor tier.";
const LOGO_SURFACE_ERROR = "Choose a valid Partner logo surface.";

type NormalizedPartnerUrl = Extract<ReturnType<typeof normalizePartnerUrl>, { success: true }>;

type FieldValidation<T> = ({ success: true } & T) | { success: false; error: string };

function validationResult(error: string): PartnerDomainResult<never> {
  return { success: false, code: "validation", error };
}

function partnerNameError(name: string, checkSecrets: boolean): string | undefined {
  if (!name) return "Partner name is required.";
  if (name.length > 200) return "Partner name must be 200 characters or shorter.";
  if (checkSecrets && unsafePartnerText(name)) return SECRET_FIELD_ERROR;
  return undefined;
}

function parsePartnerUrl(value?: string): FieldValidation<{ url: NormalizedPartnerUrl }> {
  if ((value?.trim().length || 0) > 2_000) {
    return { success: false, error: "Partner URL must be 2,000 characters or shorter." };
  }
  const url = normalizePartnerUrl(value);
  if (!url.success) return { success: false, error: "Partner URL must be an absolute HTTPS URL." };
  return { success: true, url };
}

function draftClassificationError(
  input: PartnerDraftInput,
  logoSurface: PartnerLogoSurface,
): string | undefined {
  if (!PARTNER_TYPES.includes(input.type)) return CLASSIFICATION_ERROR;
  if (input.tier && !PARTNER_TIERS.includes(input.tier)) return TIER_ERROR;
  if (!PARTNER_LOGO_SURFACES.includes(logoSurface)) return LOGO_SURFACE_ERROR;
  if (input.type === "sponsor" && !input.tier) return SPONSOR_TIER_REQUIRED_ERROR;
  return undefined;
}

function draftAttachmentError(
  input: PartnerDraftInput,
  actor: PartnerAdministrationActor,
): string | undefined {
  if (input.logo && actor !== "human_admin") {
    return "Only a human admin can upload an official Partner logo.";
  }
  const logoError = validatePartnerLogo(input.logo);
  if (logoError) return logoError;
  if (unsafePartnerText(input.logo?.name) || unsafePartnerText(input.notes)) return SECRET_FIELD_ERROR;
  return undefined;
}

function validateDraft(
  input: PartnerDraftInput,
  name: string,
  actor: PartnerAdministrationActor,
): FieldValidation<{ logoSurface: PartnerLogoSurface; url: NormalizedPartnerUrl }> {
  const logoSurface = input.logoSurface || "dark";
  const error = partnerNameError(name, true) ??
    draftClassificationError(input, logoSurface) ??
    draftAttachmentError(input, actor);
  if (error) return { success: false, error };
  const parsedUrl = parsePartnerUrl(input.url);
  if (!parsedUrl.success) return parsedUrl;
  if (unsafePartnerText(parsedUrl.url.url)) return { success: false, error: SECRET_FIELD_ERROR };
  return { success: true, logoSurface, url: parsedUrl.url };
}

interface PatchedPartnerFields {
  name: string;
  identity: string;
  type?: PartnerRecord["type"];
  requestedTier?: PartnerRecord["tier"];
  tier?: PartnerRecord["tier"];
  logoSurface?: PartnerLogoSurface;
  requestedUrl?: string;
}

interface ValidatedPartnerFields {
  name: string;
  identity: string;
  type: PartnerRecord["type"];
  tier?: PartnerRecord["tier"];
  logoSurface: PartnerLogoSurface;
  url: NormalizedPartnerUrl;
}

function resolvePatchedFields(patch: PartnerPatch, current: PartnerStoredRecord): PatchedPartnerFields {
  const normalizedName = hasOwn(patch, "name")
    ? normalizePartnerName(patch.name || "")
    : { name: current.name, identity: current.normalizedName };
  const type = hasOwn(patch, "type") ? patch.type : current.type;
  const requestedTier = hasOwn(patch, "tier") ? patch.tier || undefined : current.tier;
  return {
    ...normalizedName,
    type,
    requestedTier,
    tier: type === "sponsor" ? requestedTier : undefined,
    logoSurface: hasOwn(patch, "logoSurface") ? patch.logoSurface : current.logoSurface,
    requestedUrl: hasOwn(patch, "url") ? patch.url || undefined : current.url,
  };
}

function patchedClassificationError(fields: PatchedPartnerFields): string | undefined {
  if (!fields.type || !PARTNER_TYPES.includes(fields.type)) return CLASSIFICATION_ERROR;
  if (fields.requestedTier && !PARTNER_TIERS.includes(fields.requestedTier)) return TIER_ERROR;
  if (fields.type === "sponsor" && !fields.tier) return SPONSOR_TIER_REQUIRED_ERROR;
  if (!fields.logoSurface || !PARTNER_LOGO_SURFACES.includes(fields.logoSurface)) {
    return LOGO_SURFACE_ERROR;
  }
  return undefined;
}

function patchedContentError(patch: PartnerPatch, url: NormalizedPartnerUrl): string | undefined {
  if (
    (hasOwn(patch, "url") && unsafePartnerText(url.url)) ||
    (hasOwn(patch, "notes") && unsafePartnerText(patch.notes)) ||
    (hasOwn(patch, "logo") && unsafePartnerText(patch.logo?.name))
  ) {
    return SECRET_FIELD_ERROR;
  }
  return hasOwn(patch, "logo") ? validatePartnerLogo(patch.logo) : undefined;
}

function validatePatchedFields(
  patch: PartnerPatch,
  fields: PatchedPartnerFields,
): FieldValidation<{ fields: ValidatedPartnerFields }> {
  const error = partnerNameError(fields.name, hasOwn(patch, "name")) ??
    patchedClassificationError(fields);
  if (error) return { success: false, error };
  const parsedUrl = parsePartnerUrl(fields.requestedUrl);
  if (!parsedUrl.success) return parsedUrl;
  const contentError = patchedContentError(patch, parsedUrl.url);
  if (contentError) return { success: false, error: contentError };
  return {
    success: true,
    fields: {
      name: fields.name,
      identity: fields.identity,
      type: fields.type as PartnerRecord["type"],
      tier: fields.tier,
      logoSurface: fields.logoSurface as PartnerLogoSurface,
      url: parsedUrl.url,
    },
  };
}

function patchedStoreInput(
  patch: PartnerPatch,
  current: PartnerStoredRecord,
  fields: ValidatedPartnerFields,
): PartnerStoreUpdateInput {
  return {
    name: fields.name,
    normalizedName: fields.identity,
    published: current.published,
    type: fields.type,
    tier: fields.tier,
    logoSurface: fields.logoSurface,
    logo: hasOwn(patch, "logo") ? patch.logo : undefined,
    logoUploadedByHuman: hasOwn(patch, "logo")
      ? Boolean(patch.logo)
      : current.logoUploadedByHuman,
    url: fields.url.url,
    canonicalUrl: fields.url.canonicalUrl,
    notes: hasOwn(patch, "notes") ? patch.notes?.trim() || undefined : current.notes,
    noteAgentVisible: hasOwn(patch, "notes") ? false : current.noteAgentVisible,
  };
}

const PARTNER_PATCH_FIELDS = new Set([
  "name",
  "type",
  "tier",
  "url",
  "notes",
  "logo",
  "logoSurface",
]);

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
    const draft = validateDraft(input, name, this.actor);
    if (!draft.success) return validationResult(draft.error);
    const { logoSurface, url: normalizedUrl } = draft;

    const existing = await this.store.list();
    const duplicate = this.duplicateOf(existing, normalizedName, normalizedUrl.canonicalUrl);
    if (duplicate) return duplicate;

    let record: PartnerStoredRecord;
    try {
      record = await this.store.create({
        name,
        normalizedName,
        published: false,
        type: input.type,
        tier: input.type === "sponsor" ? input.tier || undefined : undefined,
        logo: input.logo || undefined,
        logoSurface,
        logoUploadedByHuman: Boolean(input.logo),
        url: normalizedUrl.url,
        canonicalUrl: normalizedUrl.canonicalUrl,
        notes: input.notes?.trim() || undefined,
        noteAgentVisible: false,
      });
    } catch (error) {
      return this.racedDuplicate(error, normalizedName, normalizedUrl.canonicalUrl);
    }

    return this.mutationResult(record, existing, normalizedName, normalizedUrl.canonicalUrl);
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
    const shapeError = this.patchShapeError(patch);
    if (shapeError) return validationResult(shapeError);

    const current = await this.store.get(id);
    if (!current) {
      return { success: false, code: "not_found", error: "Partner was not found." };
    }
    const editError = this.editError(current, expectedConcurrencyValue, concurrencyField);
    if (editError) return editError;

    const validated = validatePatchedFields(patch, resolvePatchedFields(patch, current));
    if (!validated.success) return validationResult(validated.error);
    const fields = validated.fields;

    const existing = (await this.store.list()).filter((record) => record.id !== id);
    const duplicate = this.duplicateOf(existing, fields.identity, fields.url.canonicalUrl);
    if (duplicate) return duplicate;

    const input = patchedStoreInput(patch, current, fields);
    const candidatePublication = publicationReadiness(updatedStoredRecord(current, input));
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
      const stored = await this.store.update(id, current.version, input);
      if (!stored.success) return staleResult(stored.current, this.actor);
      record = stored.record;
    } catch (error) {
      return this.racedDuplicate(error, fields.identity, fields.url.canonicalUrl);
    }

    return this.mutationResult(record, existing, fields.identity, fields.url.canonicalUrl);
  }

  private patchShapeError(patch: PartnerPatch): string | undefined {
    const keys = Object.keys(patch);
    if (keys.length === 0) return "Partner patch is empty.";
    if (keys.some((key) => !PARTNER_PATCH_FIELDS.has(key))) {
      return "Partner patch contains fields that cannot be changed.";
    }
    if (hasOwn(patch, "logo") && this.actor !== "human_admin") {
      return "Only a human admin can upload or remove an official Partner logo.";
    }
    return undefined;
  }

  private editError(
    current: PartnerStoredRecord,
    expectedConcurrencyValue: string,
    concurrencyField: "version" | "updated_at",
  ): PartnerDomainResult<never> | undefined {
    if (current.published && this.actor !== "human_admin") {
      return validationResult("Only a human admin can edit a Published Partner.");
    }
    const currentValue = concurrencyField === "version" ? current.version : current.updatedAt;
    if (!expectedConcurrencyValue || currentValue !== expectedConcurrencyValue) {
      return staleResult(current, this.actor);
    }
    return undefined;
  }

  private duplicateOf(
    existing: PartnerStoredRecord[],
    normalizedName: string,
    canonicalUrl: string,
  ): PartnerDomainResult<never> | undefined {
    const duplicateName = existing.find((record) => record.normalizedName === normalizedName);
    if (duplicateName) return duplicateResult("name", duplicateName, this.actor);
    const duplicateUrl = canonicalUrl
      ? existing.find((record) => record.canonicalUrl === canonicalUrl)
      : undefined;
    if (duplicateUrl) return duplicateResult("url", duplicateUrl, this.actor);
    return undefined;
  }

  private async racedDuplicate(
    error: unknown,
    normalizedName: string,
    canonicalUrl: string,
  ): Promise<PartnerDomainResult<never>> {
    if (!(error instanceof PartnerStoreConflictError)) throw error;
    const raced = (await this.store.list()).find((candidate) =>
      error.field === "name"
        ? candidate.normalizedName === normalizedName
        : candidate.canonicalUrl === canonicalUrl,
    );
    if (!raced) throw error;
    return duplicateResult(error.field, raced, this.actor);
  }

  private mutationResult(
    record: PartnerStoredRecord,
    existing: PartnerStoredRecord[],
    normalizedName: string,
    canonicalUrl: string,
  ): PartnerDomainResult<{
    partner: PartnerAdminSnapshot;
    warnings: PartnerWarning[];
    publication: PartnerPublicationReadiness;
  }> {
    return {
      success: true,
      data: {
        partner: snapshot(record, this.actor),
        warnings: similarityWarnings(existing, normalizedName, canonicalUrl),
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
    if (approved && unsafePartnerText(current.notes)) {
      return {
        success: false,
        code: "validation",
        error: "Remove credentials or secret hashes from the Partner Note before approving agent visibility.",
      };
    }

    const stored = await this.store.update(id, current.version, {
      name: current.name,
      normalizedName: current.normalizedName,
      published: current.published,
      type: current.type,
      tier: current.tier,
      logoSurface: current.logoSurface,
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
      logoSurface: current.logoSurface,
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

function safeAdminActionText(value: string, redacted: string): string {
  return containsAdminActionSecretMaterial(value) ? redacted : value;
}

function redactAdminActionSecretMaterial(value: AdminActionValue): AdminActionValue {
  if (typeof value === "string") return safeAdminActionText(value, "[redacted credential or hash]");
  if (Array.isArray(value)) return value.map(redactAdminActionSecretMaterial);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactAdminActionSecretMaterial(item)]),
  );
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
    | "logoSurface"
    | "url"
    | "notes"
    | "noteAgentVisible"
  >,
  changedFields: string[] = [],
): AdminActionValue {
  return {
    id: partner.id,
    name: safeAdminActionText(partner.name, "Redacted Partner name"),
    published: partner.published,
    type: partner.type,
    tier: partner.tier || null,
    logoSurface: partner.logoSurface,
    logoPresent: Boolean(partner.logo),
    urlPresent: Boolean(partner.url),
    notePresent: Boolean(partner.notes),
    noteAgentVisible: partner.noteAgentVisible,
    changedFields,
  };
}

function safeCreateSummary(input: PartnerStoreCreateInput): AdminActionValue {
  return {
    name: safeAdminActionText(input.name, "Redacted Partner name"),
    published: false,
    type: input.type,
    tier: input.tier || null,
    logoSurface: input.logoSurface,
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
    | "logoSurface"
    | "url"
    | "noteAgentVisible"
    | "createdAt"
    | "updatedAt"
    | "version"
  >,
): Omit<PartnerAdminSnapshot, "notes"> {
  return {
    id: partner.id,
    name: safeAdminActionText(partner.name.slice(0, 200), "Redacted Partner name"),
    published: partner.published,
    type: partner.type,
    tier: partner.tier,
    logo: safeAdminActionText(partner.logo.slice(0, 255), "Redacted Partner logo"),
    logoSurface: partner.logoSurface,
    url: partner.url
      ? safeAdminActionText(partner.url.slice(0, 2_000), "[redacted credential or hash]")
      : undefined,
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
  return redactAdminActionSecretMaterial(toAdminActionValue({
    kind: "partner_mutation",
    data: {
      partner: replayPartnerSnapshot(partner),
      warnings,
      publication,
    },
  }));
}

function isActionObject(value: AdminActionValue): value is { [key: string]: AdminActionValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function completePartnerMutationAdminAction(
  completion: AdminActionCompletion,
  record: PartnerStoredRecord,
): AdminActionCompletion {
  const afterSummary = isActionObject(completion.afterSummary)
    ? { ...completion.afterSummary, id: record.id }
    : completion.afterSummary;
  const replayResult = completion.replayResult;
  let completedReplayResult: AdminActionValue = { kind: "partner_delete", data: { id: record.id } };
  if (
    isActionObject(replayResult) &&
    replayResult.kind === "partner_mutation" &&
    isActionObject(replayResult.data)
  ) {
    completedReplayResult = redactAdminActionSecretMaterial(toAdminActionValue({
      ...replayResult,
      data: {
        ...replayResult.data,
        partner: replayPartnerSnapshot(record),
      },
    }));
  }
  return {
    ...completion,
    targetId: record.id,
    afterSummary,
    replayResult: completedReplayResult,
  };
}

function actionUrlValue(value?: string | null): string | null {
  return value?.trim() || null;
}

const PATCH_ACTION_FIELDS = new Map<string, (patch: PartnerPatch) => Record<string, AdminActionValue>>([
  ["name", (patch) => {
    const normalizedName = normalizePartnerName(patch.name || "");
    return { name: normalizedName.name, normalizedName: normalizedName.identity };
  }],
  ["url", (patch) => {
    const normalized = normalizePartnerUrl(patch.url || undefined);
    return {
      url: normalized.success ? normalized.canonicalUrl || null : actionUrlValue(patch.url),
      urlValue: actionUrlValue(patch.url),
    };
  }],
  ["notes", (patch) => ({ partnerNote: actionNote(patch.notes) })],
  ["logo", (patch) => ({ logo: actionLogo(patch.logo) })],
  ["type", (patch) => ({ type: patch.type || null })],
  ["tier", (patch) => ({ tier: patch.tier || null })],
  ["logoSurface", (patch) => ({ logoSurface: patch.logoSurface || null })],
]);

const UNRESOLVED_PARTNER_OPERATIONS = {
  pending: {
    code: "operation_pending",
    error: "This Partner operation is already in progress.",
  },
  mismatch: {
    code: "operation_mismatch",
    error: "This operation ID is already bound to different Partner input.",
  },
} as const;

function unresolvedOperationResult(
  outcome: keyof typeof UNRESOLVED_PARTNER_OPERATIONS,
  action: AdminActionRecord,
): PartnerAdministrationResult<never> {
  return {
    success: false,
    ...UNRESOLVED_PARTNER_OPERATIONS[outcome],
    action: unresolvedAction(action),
  };
}

function replayResultFromData(data: PartnerMutationData): AdminActionValue {
  if ("id" in data) return { kind: "partner_delete", data: { id: data.id } };
  const { notes: _notes, ...partner } = data.partner;
  return redactAdminActionSecretMaterial(toAdminActionValue({
    kind: "partner_mutation",
    data: {
      partner,
      warnings: data.warnings.slice(0, 3),
      publication: data.publication,
    },
  }));
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
    logoSurface: input.logoSurface,
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
        logoSurface: input.logoSurface || "dark",
        url: normalizedUrl.success ? normalizedUrl.canonicalUrl : actionUrlValue(input.url),
        urlValue: actionUrlValue(input.url),
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
      const normalizeField = PATCH_ACTION_FIELDS.get(key);
      if (normalizeField) Object.assign(normalizedPatch, normalizeField(patch));
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
      return { result: unresolvedOperationResult(reclaimed.outcome, reclaimed.action) };
    }
    if (inspected.outcome === "replayed") {
      return { result: await this.replay<T>(inspected.action) };
    }
    return { result: unresolvedOperationResult(inspected.outcome, inspected.action) };
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
        if (started.outcome !== "started") {
          throw new PartnerAdminActionFlow(unresolvedOperationResult(started.outcome, started.action));
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
          logoSurface: input.logoSurface,
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

      return await this.appliedMutation<T>(request, result.data);
    } catch (error) {
      return this.recoveredMutation<T>(request, error, activeHandle);
    }
  }

  private async appliedMutation<T extends PartnerMutationData>(
    request: AdminActionRequest,
    data: T,
  ): Promise<PartnerAdministrationResult<T>> {
    const applied = await this.adminActions.inspect(request);
    if (applied.outcome === "new" || applied.outcome === "retryable") {
      return this.recordUnreservedMutation<T>(request, data);
    }
    if (applied.outcome === "replayed") {
      return this.replay<T>(applied.action, false);
    }
    throw new Error("Partner mutation returned before its Admin Action was applied.");
  }

  private async recordUnreservedMutation<T extends PartnerMutationData>(
    request: AdminActionRequest,
    data: T,
  ): Promise<PartnerAdministrationResult<T>> {
    const partner = "partner" in data ? data.partner : undefined;
    const started = await this.adminActions.start(request);
    if (started.outcome === "replayed") return this.replay<T>(started.action);
    if (started.outcome !== "started") {
      throw new PartnerAdminActionFlow(unresolvedOperationResult(started.outcome, started.action));
    }
    const completed = await this.adminActions.complete(started.handle, {
      targetId: partner?.id,
      beforeSummary: partner ? safePartnerSummary(partner) : null,
      afterSummary: partner ? safePartnerSummary(partner) : null,
      replayResult: replayResultFromData(data),
    });
    return this.replay<T>(completed, false);
  }

  private async recoveredMutation<T>(
    request: AdminActionRequest,
    error: unknown,
    activeHandle: AdminActionHandle | undefined,
  ): Promise<PartnerAdministrationResult<T>> {
    if (error instanceof PartnerAdminActionFlow) return error.result as PartnerAdministrationResult<T>;
    const inspected = await this.adminActions.inspect(request);
    if (inspected.outcome === "replayed") return this.replay<T>(inspected.action);
    if (!activeHandle) throw error;
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
}
