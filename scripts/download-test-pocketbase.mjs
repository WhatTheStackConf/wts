import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = "0.30.4";
const target = fileURLToPath(new URL("../pocketbase/pocketbase", import.meta.url));
const installed = spawnSync(target, ["--version"], { encoding: "utf8" });
if (installed.status === 0 && installed.stdout.trim() === `pocketbase version ${version}`) {
  console.log(`PocketBase ${version} already installed`);
} else {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Pinned test download currently supports linux amd64 only; install PocketBase 0.30.4 manually");
  const root = await mkdtemp(join(tmpdir(), "wts-pb-download-"));
  try {
    const name = `pocketbase_${version}_linux_amd64.zip`;
    const url = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/${name}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Pinned PocketBase download failed: ${response.status} ${url}`);
    const archive = join(root, name);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const unzip = spawnSync("unzip", ["-q", archive, "pocketbase", "-d", root], { encoding: "utf8" });
    if (unzip.status !== 0) throw new Error(`Cannot unpack pinned PocketBase: ${unzip.stderr}`);
    const downloaded = join(root, "pocketbase");
    await chmod(downloaded, 0o755);
    const verify = spawnSync(downloaded, ["--version"], { encoding: "utf8" });
    if (verify.status !== 0 || verify.stdout.trim() !== `pocketbase version ${version}`) throw new Error("Downloaded PocketBase version mismatch");
    await copyFile(downloaded, target);
    await chmod(target, 0o755);
    console.log(`Installed PocketBase ${version} for disposable tests`);
  } finally { await rm(root, { recursive: true, force: true }); }
}
