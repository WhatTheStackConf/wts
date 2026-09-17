/** Consume initial and same-document station links without retaining QR material.
 * Call from onSettled and return the disposer with the page's other listeners.
 * The callback stages review only; it must never bind or replace held work.
 */
export function listenForProvisioningFragment(receive: (code: string | undefined) => void) {
  const consume = () => {
    const fragment = window.location.hash;
    if (!fragment) return;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    receive(/^#provision=([a-f0-9]{64})$/.exec(fragment)?.[1]);
  };
  window.addEventListener("hashchange", consume);
  consume();
  return () => window.removeEventListener("hashchange", consume);
}
