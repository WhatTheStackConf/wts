import DOMPurify from "isomorphic-dompurify";

export function sanitizeHtml(value: string | null | undefined) {
  return DOMPurify.sanitize(value ?? "");
}
