import {
  configureServerFunctionsClient,
  getServerFunctionsCodec,
  serializeString,
} from "@solidjs/web/server-functions/client";

/** Configure before rendering: optional DTO fields must survive browser RPCs. */
export function initializeServerFunctionTransport(): void {
  // Solid 2's JSON fast path rejects even nested undefined. The built-in rich
  // codec preserves it (unlike JSON normalization, which drops keys or turns
  // array slots into null). JSON-safe calls and native uploads keep their usual
  // encodings; unsupported classes/functions still fail before fetch.
  // The server already decodes this wire format; no auth/handler change needed.
  // Equivalent to enableRichArguments(). RC.3's rich-args entry self-imports
  // .../server-functions/client from a nested package that doesn't export
  // ./client, which Rolldown rejects. Import these public exports from the app
  // instead; do not replace the codec with lossy JSON.stringify normalization.
  configureServerFunctionsClient({
    serializeArgs: (args) => serializeString(args, getServerFunctionsCodec()),
  });
}