/**
 * Returns the readable text of a raw SMTP message, for link extraction in acceptance runs.
 * Only parts that declare quoted-printable are decoded. A 7bit body stays as it is, so a token
 * such as "token=4DAa..." keeps its "=4D" instead of turning into "M".
 */
export function mailText(raw) {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(raw)?.[1];
  const parts = boundary ? raw.split(`--${boundary}`) : [raw];
  return parts.map(partText).join('\n');
}

function partText(part) {
  const split = /\r?\n\r?\n/.exec(part);
  if (!split) return part;
  const headers = part.slice(0, split.index);
  const body = part.slice(split.index + split[0].length);
  return /^content-transfer-encoding:\s*quoted-printable/im.test(headers) ? decodeQuotedPrintable(body) : body;
}

function decodeQuotedPrintable(body) {
  return body.replace(/=\r?\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
