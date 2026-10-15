import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { AgentError } from "./protocol.js";
const lifetimeLeases = new Set<Server>();

/** Kernel-owned loopback leases work on macOS/Linux, survive no stale PID files,
 * and disappear only when the owning worker closes/exits. Hash collisions fail
 * closed (false contention), never allow two owners. No commands or data served. */
export async function acquireOwnership(resources: string[], processLifetime = false): Promise<() => Promise<void>> {
  const servers: Server[] = [];
  const release = async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); };
  try {
    const ports = [...new Set(resources.map(resource => {
      if (!resource || resource.length > 4096) throw new AgentError("invalid_config");
      return 20000 + createHash("sha256").update(`wts-print-owner-v1:${resource}`).digest().readUInt32BE(0) % 20000;
    }))].sort((a, b) => a - b);
    for (const port of ports) {
      const server = createServer(socket => socket.destroy());
      server.maxConnections = 1;
      await new Promise<void>((resolve, reject) => {
        const failed = () => reject(new AgentError("resource_owned"));
        server.once("error", failed);
        server.listen({ host: "127.0.0.1", port, exclusive: true }, () => { server.removeListener("error", failed); resolve(); });
      });
      servers.push(server);
    }
    if (processLifetime) {
      for (const server of servers) { lifetimeLeases.add(server); server.unref(); }
      return async () => {}; // Only process exit may release these leases.
    }
    return release;
  } catch (error) { await release(); throw error; }
}
