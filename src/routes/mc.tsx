import { Meta } from "@solidjs/meta";
import { Layout } from "~/layouts/Layout";
import { LiveQaDashboard } from "~/components/LiveQaDashboard";

export default function McPage() {
  return (
    <Layout title="MC dashboard — WhatTheStack 2026" description="Private live Q&A moderation for conference MCs.">
      <Meta name="robots" content="noindex,nofollow" />
      <div class="w-full max-w-4xl px-4 py-8 space-y-6">
        <header class="space-y-3">
          <p class="speaker-kicker">Live Q&A</p>
          <h1 class="font-star text-3xl md:text-4xl text-secondary-400">MC dashboard</h1>
          <p class="text-primary-200">Questions are visible only to their author, MCs and administrators.</p>
        </header>
        <LiveQaDashboard />
      </div>
    </Layout>
  );
}
