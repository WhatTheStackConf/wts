import { it, expect } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { readRegistrations } from "./registrations-source";
it.skipIf(!process.env.WTS_REGISTRATION_LIVE_CONFIG)("privately validates complete live GET roster contract", async () => {
 const config = JSON.parse(readFileSync(process.env.WTS_REGISTRATION_LIVE_CONFIG!, "utf8"));
 const result = await readRegistrations(config);
 expect(result.registrations.every(row => ["15", "16", "17"].includes(row.programmeId))).toBe(true);
 expect(Number.isFinite(Date.parse(result.refreshedAt))).toBe(true);
}, 90000);
