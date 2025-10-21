import { Layout } from "../layouts/Layout";

export default function Home() {
  return (
    <Layout
      title="WhatTheStack 2026 - Blade Runner Theme"
      description="WhatTheStack 2026 - A futuristic developer conference"
    >
      <div class="container mx-auto px-4 py-16 text-center relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-5xl md:text-7xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-6 neon-glow fade-in">
            WhatTheStack 2026
          </h1>
          <div class="h-1 w-32 bg-primary-500 mx-auto mb-8 fade-in-delay-1"></div>
          <p class="text-xl md:text-2xl text-secondary-300 mb-12 font-sans fade-in-delay-1">
            Enter the neon-lit future of web development in the heart of Skopje
          </p>

          <div class="bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 mb-12 fade-in-delay-2 grid-scan">
            <h2 class="text-3xl font-star text-primary-500 mb-4">
              Blade Runner 2026
            </h2>
            <p class="text-lg text-secondary-300">
              Join us for an immersive experience that bridges the gap between
              technology and humanity in a dystopian future. The lines between
              reality and virtuality blur as we explore the cutting edge of web
              development.
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 fade-in-delay-3">
            <div class="bg-base-200/50 backdrop-blur-sm border border-primary-500/30 rounded-lg p-6 hover-pulse transition-all duration-300">
              <h3 class="text-xl font-bold text-primary-500 mb-2">
                Epic Talks
              </h3>
              <p class="text-secondary-300">
                From replicants to reality - cutting edge presentations by
                industry leaders
              </p>
            </div>
            <div class="bg-base-200/50 backdrop-blur-sm border border-primary-500/30 rounded-lg p-6 hover-pulse transition-all duration-300">
              <h3 class="text-xl font-bold text-primary-500 mb-2">
                Neon Networking
              </h3>
              <p class="text-secondary-300">
                Connect with fellow developers in our retro-futuristic
                environment
              </p>
            </div>
            <div class="bg-base-200/50 backdrop-blur-sm border border-primary-500/30 rounded-lg p-6 hover-pulse transition-all duration-300">
              <h3 class="text-xl font-bold text-primary-500 mb-2">
                Tech Afterparty
              </h3>
              <p class="text-secondary-300">
                Experience the future with our synthwave afterparty
              </p>
            </div>
          </div>

          <div class="mb-12 fade-in-delay-4">
            <a
              href="/tickets"
              class="btn btn-primary text-xl px-8 py-4 font-star tracking-wider text-base-100 hover:bg-primary-600 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-primary-500/30 neon-glow hover-pulse"
            >
              SECURE YOUR PASS
            </a>
          </div>

          <div class="text-left bg-base-200/50 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 fade-in-delay-4 grid-scan">
            <h3 class="text-2xl font-star text-primary-500 mb-4">
              About WhatTheStack
            </h3>
            <p class="text-secondary-300 mb-4">
              <strong>
                A by-developers, for-developers event in the heart of Skopje in
                September 2026
              </strong>
            </p>
            <p class="text-secondary-300 mb-4">
              WTS is described as a response to the formal nature of traditional
              conferences, aiming to create a more authentic community
              experience. It's positioned as a single-day, multi-track event
              celebrating web development, the web platform, and web standards,
              without a formal dress code.
            </p>
            <p class="text-secondary-300 mb-4">
              <strong>Key Features:</strong>
            </p>
            <ul class="list-disc list-inside text-secondary-300 mb-4 space-y-2">
              <li>
                <strong>Epic talks</strong> from both well-known and newcomer
                speakers who genuinely love the web
              </li>
              <li>
                <strong>Coffee, beers, and gourmet food</strong> (highlighting
                Balkan cuisine)
              </li>
              <li>
                <strong>Community-focused atmosphere</strong> designed to help
                attendees find their "tribe"
              </li>
            </ul>
            <p class="text-secondary-300">
              The event aims to be an annual gathering for web developers,
              emphasizing authentic experiences and community connection over
              formal conference structures.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
