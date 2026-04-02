import { Layout } from "../layouts/Layout";

export default function NotFound() {
  return (
    <Layout
      title="404 - WhatTheStack"
      description="Page not found"
    >
      <div class="w-full min-h-[80vh] flex items-center justify-center px-4 relative">
        <div class="absolute inset-0 scanline z-10 pointer-events-none"></div>
        <div class="text-center relative z-20">
          <h1
            class="glitch-404 font-star leading-none mb-6 fade-in select-none"
            data-text="404"
          >
            404
          </h1>
          <p class="text-2xl md:text-4xl font-star text-white mb-4 fade-in-delay-1 tracking-wider uppercase">
            Lost in the Stack
          </p>
          <p class="text-secondary-300 text-lg mb-10 fade-in-delay-2 max-w-md mx-auto">
            All those routes will be lost in time, like tears in rain.
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center fade-in-delay-3">
            <a
              href="/"
              class="btn-hologram px-8 py-3 rounded font-star tracking-widest uppercase text-sm"
            >
              <span class="text-content" data-text="&gt; Go Home">&gt; Go Home</span>
              <span class="scan-line"></span>
            </a>
            <a
              href="/tickets"
              class="btn-hologram px-8 py-3 rounded font-star tracking-widest uppercase text-sm"
            >
              <span class="text-content" data-text="&gt; Grab a Ticket">&gt; Grab a Ticket</span>
              <span class="scan-line"></span>
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
