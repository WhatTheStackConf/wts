import { Title } from "@solidjs/meta";
import { Layout } from "../layouts/Layout";

export default function About() {
  return (
    <Layout
      title="About WhatTheStack 2026"
      description="Learn more about the future of web development"
    >
      <div class="container mx-auto px-4 py-16 relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-8 text-center neon-glow fade-in">
            About WhatTheStack 2026
          </h1>

          <div class="bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 mb-8 fade-in-delay-1 grid-scan">
            <h2 class="text-2xl font-star text-primary-500 mb-4">
              A by-developers, for-developers event in the heart of Skopje in
              September 2026
            </h2>
            <p class="text-lg text-secondary-300 mb-6">
              WTS is described as a response to the formal nature of traditional
              conferences, aiming to create a more authentic community
              experience. It's positioned as a single-day, multi-track event
              celebrating web development, the web platform, and web standards,
              without a formal dress code.
            </p>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-6 fade-in-delay-2"></div>

            <h3 class="text-xl font-bold text-secondary-300 mb-4 fade-in-delay-2">
              Key Features:
            </h3>
            <ul class="space-y-3 mb-6 fade-in-delay-3">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>Epic talks</strong> from both well-known and newcomer
                  speakers who genuinely love the web
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>Coffee, beers, and gourmet food</strong> (highlighting
                  Balkan cuisine)
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>Community-focused atmosphere</strong> designed to help
                  attendees find their "tribe"
                </span>
              </li>
            </ul>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-6 fade-in-delay-3"></div>

            <h3 class="text-xl font-bold text-secondary-300 mb-4 fade-in-delay-3">
              Organizers:
            </h3>
            <ul class="space-y-3 mb-6 fade-in-delay-4">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>DeveD</strong>: Started from BeerJS events, focused on
                  developer education and IT community building
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>Base42</strong>: A collective promoting hacker culture
                  in the Balkans through hackerspaces and open tech communities
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2">•</span>
                <span class="text-secondary-300">
                  <strong>Angular Macedonia</strong>: A community of Angular
                  enthusiasts for learning and collaboration
                </span>
              </li>
            </ul>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-6 fade-in-delay-4"></div>

            <h3 class="text-xl font-bold text-secondary-300 mb-4 fade-in-delay-4">
              Looking Forward to 2026:
            </h3>
            <p class="text-secondary-300 mb-6 fade-in-delay-4">
              The 2026 event continues our tradition of bringing together web
              developers in an authentic, community-driven environment. As we
              step into the future, we're excited to explore new technologies
              and connect with the ever-growing web development community.
            </p>

            <div class="text-center mt-8 fade-in-delay-4">
              <a
                href="/tickets"
                class="btn btn-primary px-6 py-3 font-star tracking-wider text-base-100 hover:bg-primary-600 transition-all duration-300 neon-glow hover-pulse"
              >
                SECURE YOUR PASS FOR 2026
              </a>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
