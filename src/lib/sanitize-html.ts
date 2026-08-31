import sanitize from "sanitize-html";

export function sanitizeHtml(value: string | null | undefined) {
  return sanitize(value ?? "", {
    allowedTags: [...sanitize.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...sanitize.defaults.allowedAttributes,
      "*": ["class", "id", "role", "aria-*"],
      a: ["href", "name", "target", "rel", "class", "aria-*"],
      img: ["src", "srcset", "alt", "title", "width", "height", "loading", "class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}
