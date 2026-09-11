import { readFileSync, statSync } from "node:fs";
import { AgentError, object } from "./protocol.js";

/** Paths only in argv; file contents never enter diagnostics. */
export function readPrivateFile(path: unknown): string {
  if (typeof path !== "string") throw new AgentError("invalid_config");
  try {
    const stat = statSync(path);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 16384) throw new Error();
    return readFileSync(path, "utf8");
  } catch { throw new AgentError("invalid_config"); }
}
export function readPrivateObject(path: unknown): Record<string, unknown> {
  try { return object(JSON.parse(readPrivateFile(path))); }
  catch { throw new AgentError("invalid_config"); }
}
