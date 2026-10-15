import { cp, mkdir, readdir, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

const APP_DIRECTORIES = ["src", "public", "content", "scripts", "runtime"];
const APP_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.checkin-runtime.json", "vite.config.ts"];
const SKIPPED_MODULES = [".nitro", ".vite", ".cache", ".vite-temp"];

/** Copies the buildable app into appDir without any .env file and links the repo's node_modules. */
export async function copyApp(repo, appDir, extraFiles = []) {
  await mkdir(appDir);
  for (const directory of APP_DIRECTORIES) {
    await cp(join(repo, directory), join(appDir, directory), { recursive: true, filter: (path) => !path.split(/[\\/]/).some((part) => part.startsWith(".env")) });
  }
  for (const name of [...APP_FILES, ...extraFiles]) await cp(join(repo, name), join(appDir, name));
  await mkdir(join(appDir, "node_modules"));
  for (const name of await readdir(join(repo, "node_modules"))) {
    if (SKIPPED_MODULES.includes(name)) continue;
    await symlink(join(repo, "node_modules", name), join(appDir, "node_modules", name));
  }
}

export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("Could not allocate disposable port");
  return address.port;
}
