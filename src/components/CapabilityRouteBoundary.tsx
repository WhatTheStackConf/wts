import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useCapabilityRouteAvailability } from "~/lib/route-guards";

export function CapabilityRouteBoundary(props: { children: JSX.Element }) {
  const access = useCapabilityRouteAvailability();

  return (
    <Show when={access.available()} fallback={
      <div class="flex min-h-[60vh] w-full items-center justify-center px-4 text-center">
        <div>
          <Show when={access.checking()} fallback={
            <>
              <h1 class="text-4xl font-bold">404</h1>
              <p class="mt-3">Page not found.</p>
            </>
          }>
            <p role="status">Checking page availability…</p>
          </Show>
        </div>
      </div>
    }>
      {props.children}
    </Show>
  );
}

