import { Layout } from "~/layouts/Layout";

interface ComingSoonProps {
  title: string;
  subtitle?: string;
}

export const ComingSoon = (props: ComingSoonProps) => {
  return (
    <Layout
      title={`${props.title} - WhatTheStack 2026`}
      description={props.subtitle || `${props.title} coming soon`}
      ogSubtitle={props.subtitle || "Coming soon"}
    >
      <div class="w-full min-h-[60vh] flex items-center justify-center px-4 relative">
        <div class="absolute inset-0 scanline z-10 pointer-events-none"></div>
        <div class="text-center relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-6 neon-glow fade-in uppercase tracking-widest">
            {props.title}
          </h1>
          <p class="text-2xl md:text-3xl font-star text-white/30 mb-6 fade-in-delay-1 tracking-wider uppercase">
            Coming Soon
          </p>
          <p class="text-secondary-300 text-lg mb-10 fade-in-delay-2 max-w-md mx-auto">
            {props.subtitle || "We're working on it. Stay tuned."}
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center fade-in-delay-3">
            <a
              href="/timeline"
              class="btn-hologram px-8 py-3 rounded font-star tracking-widest uppercase text-sm"
            >
              <span class="text-content" data-text="&gt; View Timeline">&gt; View Timeline</span>
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
};
