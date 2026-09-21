import { Layout } from "~/layouts/Layout";
import { Show } from "solid-js";

interface RegistrationClosedProps {
  account?: boolean;
}

export function RegistrationClosed(props: RegistrationClosedProps) {
  return (
    <Layout title="Registration closed - WhatTheStack 2026" description="WhatTheStack 2026 has ended. Ticket bookings and new account registrations are closed.">
      <section class="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 class="font-star text-4xl text-primary-500">Registration closed</h1>
        <p class="mt-6 text-lg text-secondary-200">Thanks for being part of WhatTheStack 2026! The conference has ended, and ticket bookings and new account registrations are now closed.</p>
        <p class="mt-4 text-secondary-200">Existing accounts and tickets are unaffected. You can still log in to your account.</p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a class="btn btn-primary" href={props.account ? "/login" : "/agenda"}><Show when={props.account} fallback="View the programme">Log in</Show></a>
          <a class="btn btn-ghost" href="/">Back to home</a>
        </div>
      </section>
    </Layout>
  );
}
