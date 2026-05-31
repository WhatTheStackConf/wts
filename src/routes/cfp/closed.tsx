import { Layout } from "~/layouts/Layout";
import { Icon } from "@iconify-icon/solid";
import { clientOnly } from "@solidjs/start";

const CfpClosed = () => {
  return (
    <Layout
      title="Call for Papers Closed - WhatTheStack 2026"
      description="The Call for Papers for WhatTheStack 2026 is currently closed."
    >
      <div class="container mx-auto px-4 py-8">
        <div class="max-w-4xl mx-auto">
          <div class="glass-panel p-8 md:p-12 rounded-2xl border border-white/10 relative overflow-hidden text-center">
            <div class="absolute top-0 right-0 p-8 opacity-5 font-mono text-xs text-right hidden md:block select-none pointer-events-none">
              <p>SYS.CFP_STATUS</p>
              <p>STATE: CLOSED</p>
            </div>

            <h1 class="text-4xl font-bold font-star mb-6 pt-4 text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 tracking-wide">
              WHATTHESTACK 2026
            </h1>

            <div class="flex justify-center mb-8">
              <div class="p-4 rounded-full bg-warning/10 border border-warning/20">
                <Icon
                  icon="material-symbols:lock-outline"
                  class="text-5xl text-warning"
                />
              </div>
            </div>

            <h2 class="text-2xl font-bold font-star text-white mb-4">
              SUBMISSIONS ARE CLOSED
            </h2>

            <p class="text-secondary-300 font-mono text-sm max-w-lg mx-auto mb-8 leading-relaxed">
              The Call for Papers for WhatTheStack 2026 is currently closed.
              We're no longer accepting new talk proposals at this time.
            </p>

            <div class="bg-base-300/30 p-6 rounded-xl border border-white/5 mb-8 max-w-lg mx-auto">
              <p class="text-secondary-300/80 text-sm">
                If you've already submitted a proposal, you can still view and
                edit it from your{" "}
                <a href="/cfp/my-submissions" class="link link-primary font-bold">
                  submissions page
                </a>
                .
              </p>
            </div>

            <a
              href="/"
              class="btn btn-primary btn-lg font-mono px-10 shadow-[0_0_20px_rgba(var(--color-primary-500),0.3)]"
            >
              <Icon icon="material-symbols:arrow-back" />
              BACK TO HOME
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: CfpClosed }), {
  lazy: true,
});
