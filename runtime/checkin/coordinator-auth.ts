import type PocketBase from "pocketbase";
import type { SendOptions } from "pocketbase";

const routes = new Set([
  "/api/wts/checkin-agents", "/api/wts/checkin-arrivals", "/api/wts/checkin-recovery",
  "/api/wts/checkin-reset-fence", "/api/wts/checkin-lifecycle-worker", "/api/wts/checkin-lifecycle-proxy",
]);
/** These trusted PB routes authenticate before executing their commands. Only an
 * explicit 401 is safe to retry after login; never replay timeouts/5xx/mutations
 * whose response was lost. Concurrent failures share one login and owner lease. */
function aborted(options: SendOptions | undefined): boolean | undefined {
  return options?.signal?.aborted;
}
export function installCoordinatorAuthRecovery(pb: PocketBase, authenticate: () => Promise<unknown>): void {
  const send = pb.send.bind(pb);
  let login: Promise<unknown> | undefined;
  const freshOptions = (options: SendOptions | undefined): SendOptions => {
    const headers = new Headers(options?.headers);
    headers.delete("Authorization");
    return { ...options, headers: Object.fromEntries(headers.entries()) };
  };
  /** Share one login unless another request already replaced the rejected token. */
  const relogin = async (tokenAtSend: string) => {
    if (pb.authStore.token !== tokenAtSend && pb.authStore.token) return;
    if (!login) login = Promise.resolve().then(authenticate).finally(() => { login = undefined; });
    await login;
  };
  pb.send = async <T = unknown>(path: string, options?: SendOptions): Promise<T> => {
    if (!routes.has(path)) return send<T>(path, options ?? {});
    const tokenAtSend = pb.authStore.token;
    try { return await send<T>(path, freshOptions(options)); }
    catch (error) {
      if ((error as { status?: number })?.status !== 401 || aborted(options)) throw error;
      await relogin(tokenAtSend);
      if (aborted(options)) throw error;
      // Exactly one retry, using the same owner, command IDs, body and timeout.
      return send<T>(path, freshOptions(options));
    }
  };
}
