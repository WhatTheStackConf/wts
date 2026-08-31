import { useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";

interface RedirectProps {
  href: string;
  replace?: boolean;
}

export function Redirect(props: RedirectProps) {
  const navigate = useNavigate();
  createEffect(
    () => ({ href: props.href, replace: props.replace ?? true }),
    ({ href, replace }) => queueMicrotask(() => navigate(href, { replace })),
  );
  return null;
}
