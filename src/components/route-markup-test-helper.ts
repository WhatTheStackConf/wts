import { expect } from "vite-plus/test";

export const markup = (html: string) => html
  .replace(/<!--.*?-->/g, "")
  .replace(/<svg([^>]*)>[\s\S]*?<\/svg>/g, (_svg, attributes: string) => `<svg${attributes.match(/ title="[^"]*"/)?.[0] ?? ""}/>`)
  .replace(/ (?:class|style)="[^"]*"/g, "");

export const links = (html: string, { trim = true } = {}) => [...html.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map(([, href, content]) => {
    const label = content.replace(/<span aria-hidden="true">.*?<\/span>/g, "").replace(/<[^>]+>/g, "");
    return `${href} ${trim ? label.trim() : label}`;
  });

export function expectFragments(html: string, present: string[], absent: string[] = []) {
  for (const fragment of present) expect(html).toContain(fragment);
  for (const fragment of absent) expect(html).not.toContain(fragment);
}

export function expectInOrder(html: string, fragments: string[]) {
  let rest = html;
  for (const fragment of fragments) {
    expect(rest).toContain(fragment);
    rest = rest.slice(rest.indexOf(fragment) + fragment.length);
  }
}
