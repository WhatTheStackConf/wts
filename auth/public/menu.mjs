// Phone header menu. Below 768px the header is one row: the brand and a notched Menu toggle.
// The account navigation opens as a glass panel under the header. Without this script the toggle
// stays hidden and the navigation stays a plain row of links. The behavior follows
// site/src/components/PublicHeader.tsx. Change the copies together.
const WIDE = "(min-width: 768px)";

export function watchMenu(doc = document) {
  const header = doc.querySelector(".support-header");
  const toggle = header?.querySelector(".menu-toggle");
  const panel = toggle ? doc.getElementById(toggle.getAttribute("aria-controls") ?? "") : null;
  const view = doc.defaultView;
  if (!header || !toggle || !panel || !view) return () => {};

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    header.dataset.menu = open ? "open" : "ready";
  };
  const close = (refocus) => {
    if (!isOpen()) return;
    setOpen(false);
    if (refocus) toggle.focus();
  };
  const open = () => {
    setOpen(true);
    view.requestAnimationFrame(() => panel.querySelector("a, button")?.focus());
  };
  const inside = (node) => node instanceof view.Node && (panel.contains(node) || toggle.contains(node));

  const onToggle = () => (isOpen() ? close(false) : open());
  const onKey = (event) => {
    if (event.key !== "Escape" || !isOpen()) return;
    event.preventDefault();
    close(true);
  };
  const onPointer = (event) => {
    if (isOpen() && !inside(event.target)) close(false);
  };
  const onLink = (event) => {
    if (event.target instanceof view.Element && event.target.closest("a")) close(false);
  };
  // Focus that leaves the panel and the toggle closes it, so the panel never covers the focused element.
  const onFocusOut = (event) => {
    if (isOpen() && event.relatedTarget !== null && !inside(event.relatedTarget)) close(false);
  };
  const wide = view.matchMedia(WIDE);
  const onWide = (event) => {
    if (event.matches) close(false);
  };

  setOpen(false);
  toggle.hidden = false;
  toggle.addEventListener("click", onToggle);
  panel.addEventListener("click", onLink);
  header.addEventListener("focusout", onFocusOut);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onPointer);
  wide.addEventListener("change", onWide);
  return () => {
    toggle.removeEventListener("click", onToggle);
    panel.removeEventListener("click", onLink);
    header.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("pointerdown", onPointer);
    wide.removeEventListener("change", onWide);
    toggle.hidden = true;
    delete header.dataset.menu;
  };
}

if (typeof document !== "undefined") watchMenu();
