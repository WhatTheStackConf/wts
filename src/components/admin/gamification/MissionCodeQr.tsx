import { Show } from "solid-js";
import QRCode from "qrcode";
import { createAsyncResource as createResource } from "~/lib/async-resource";

/** Bearer image exists only for the current one-time code response. */
export default function MissionCodeQr(props: { path: string; codeId: string }) {
  const [image] = createResource(() => props.path, async path => {
    if (typeof window === "undefined") return "";
    const target = new URL(path, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== "/missions/redeem" || !target.hash.startsWith("#code=")) throw new Error("Invalid Mission QR destination.");
    return QRCode.toDataURL(target.href, { errorCorrectionLevel: "Q", margin: 4, width: 320, color: { dark: "#000000ff", light: "#ffffffff" } });
  });
  return <div class="mt-3">
    <Show when={image.error}><p role="alert" class="text-sm text-warning">QR image could not be rendered. Keep the one-time CSV securely and use its original link.</p></Show>
    <Show when={image()}>{source => <div class="flex flex-col items-start gap-3">
      <img src={source()} alt="Mission QR code" width="320" height="320" class="h-auto max-w-full bg-white" />
      <a class="btn btn-sm btn-outline min-h-12" href={source()} download={`wts-mission-${props.codeId}.png`}>Download QR</a>
    </div>}</Show>
  </div>;
}
