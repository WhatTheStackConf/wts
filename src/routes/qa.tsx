import { LiveQaStages } from "~/components/LiveQaStages";
import { Layout } from "~/layouts/Layout";

export default function QaPage() {
  return (
    <Layout title="Live Q&A — WhatTheStack 2026" description="Choose your main-conference stage and talk to ask a private question.">
      <div class="w-full min-w-0 max-w-5xl px-4 pb-20 pt-24 md:pt-32 space-y-6">
        <header class="space-y-3">
          <p class="speaker-kicker">Main conference day</p>
          <h1 class="font-star text-3xl md:text-4xl text-secondary-400">Live Q&A</h1>
          <p class="text-primary-200">Find your stage, choose a talk, and send your question privately.</p>
        </header>
        <LiveQaStages />
      </div>
    </Layout>
  );
}
