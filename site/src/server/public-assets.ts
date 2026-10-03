import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PublicAsset } from "../lib/public-contract.ts";
import { assetIdSchema } from "../lib/publication-schema.ts";
import { openSiteDatabase, sha256, siteDataDirectory } from "./storage.ts";

export function lookupPublicAsset(id: string, dataDir?: string): PublicAsset | null {
  if (!assetIdSchema.safeParse(id).success) return null;
  const db = openSiteDatabase(dataDir);
  try {
    const row = db.prepare("SELECT a.asset_id, a.sha256, a.media_type, a.byte_length FROM public_assets a WHERE a.asset_id=? AND EXISTS (SELECT 1 FROM snapshot_assets sa WHERE sa.asset_id=a.asset_id)").get(id);
    if (!row) return null;
    const asset = z.strictObject({ asset_id: assetIdSchema, sha256: assetIdSchema, media_type: z.string(), byte_length: z.number().int().positive() }).parse(row);
    return { id: asset.asset_id, sha256: asset.sha256, mediaType: asset.media_type, byteLength: asset.byte_length, url: `/media/${asset.asset_id}` };
  } finally { db.close(); }
}
export function readPublicAsset(id: string, dataDir?: string): { asset: PublicAsset; bytes: Buffer } | null {
  const asset = lookupPublicAsset(id, dataDir);
  if (!asset) return null;
  const directory = join(siteDataDirectory(dataDir), "assets");
  if (lstatSync(directory).isSymbolicLink()) throw new Error("Use an asset directory without a symbolic link.");
  const path = join(directory, asset.id);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The registered asset file is invalid.");
  const bytes = readFileSync(path);
  if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.sha256) throw new Error("The registered asset checksum does not match.");
  return { asset, bytes };
}
