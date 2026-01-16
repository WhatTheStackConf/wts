import { Layout } from "../layouts/Layout";
import CodeBackground from "~/components/CodeBackground";
import AlternativelyTyping from "~/components/AlternativelyTyping";

export default function About() {
  return (
    <Layout
      title="About WhatTheStack 2026"
      description="Learn more about the future of web development"
    >
      <div class="w-full h-full px-4 relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-8 text-center neon-glow fade-in">
            404 <br />
            Page Not Found
          </h1>
        </div>
      </div>
    </Layout>
  );
}
