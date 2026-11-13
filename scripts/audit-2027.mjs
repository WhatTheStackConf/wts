// Fail when a high or critical advisory reaches a 2027 app.
// The root package is the 2026 app. It deploys from its own branch, so its advisories do not block this line.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APPS_2027 = ["auth", "blog", "cfp", "site"];
const SEVERE = new Set(["high", "critical"]);

export function blockingAdvisories(report, apps = APPS_2027) {
  const blocking = [];
  for (const advisory of Object.values(report.advisories ?? {})) {
    if (!SEVERE.has(advisory.severity)) continue;
    const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []);
    const reached = paths.filter((path) => apps.includes(path.split(">")[0]));
    if (reached.length > 0) {
      blocking.push({ id: advisory.github_advisory_id, severity: advisory.severity, module: advisory.module_name, paths: reached });
    }
  }
  return blocking;
}

function readAudit() {
  const audit = spawnSync("pnpm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    return JSON.parse(audit.stdout);
  } catch {
    throw new Error(`pnpm audit did not return JSON (exit ${audit.status}).\n${audit.stderr}`);
  }
}

function main() {
  const blocking = blockingAdvisories(readAudit());
  for (const item of blocking) {
    console.error(`${item.severity} ${item.id} ${item.module}\n  ${item.paths.slice(0, 5).join("\n  ")}`);
  }
  console.log(`${blocking.length} high or critical advisories reach the 2027 apps.`);
  process.exitCode = blocking.length > 0 ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
