import { Layout } from "../layouts/Layout";
import { Hero } from "../components/Hero";

export default function Home() {
  return (
    <Layout
      title="WhatTheStack 2026"
      description="Refracting the boundaries between reality and the machine."
    >
      <div class="relative">
        {/* Main Hero Section */}
        <Hero />

        {/* Secondary Content Area */}
        <section class="max-w-6xl mx-auto py-24 px-6">
          <div class="glass-panel p-12 rounded-3xl grid-scan fade-in-delay-3">
            <h2 class="text-3xl font-star text-primary-500 mb-6 uppercase tracking-widest">
              More info coming soon!
            </h2>
            <div class="text-lg text-secondary-200 font-light leading-relaxed max-w-3xl">
              Meanwhile:
              <ul class="flex flex-col md:flex-row gap-4 text-xl font-black">
                <li>
                  <a href="/tickets" class="link  text-primary-200">
                    {`>`} Grab a ticket
                  </a>
                </li>
                <li>
                  <a href="/cfp/01-intro" class="link  text-primary-200">
                    {`>`} Apply to speak
                  </a>
                </li>
                <li>
                  <a href="/cfp" class="link  text-primary-200">
                    {`>`} Follow us
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
