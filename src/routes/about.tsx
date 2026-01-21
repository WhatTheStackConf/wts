import { Layout } from "../layouts/Layout";
import AlternativelyTyping from "~/components/AlternativelyTyping";
import { MDXContent } from "~/components/MDXContent";
import { pages } from ".velite";
import { createMemo } from "solid-js";
import { HologramButton } from "~/components/HologramButton";

export default function About() {
  const page = createMemo(() => pages.find(p => p.slug === "about"));

  return (
    <Layout
      title="About WhatTheStack 2026"
      description="Learn more about the future of web development"
    >
      <div class="w-full h-full px-4 relative">
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-8 text-center neon-glow fade-in">
            {page()?.title || "About WhatTheStack"}
          </h1>

          <div class="bg-base-300/90 backdrop-blur-md border border-primary-500/30 rounded-lg p-8 mb-8 fade-in-delay-1 grid-scan shadow-2xl relative z-30">
            {page() && <MDXContent code={page()!.content} />}

            <p class="text-lg text-gray-200 mb-6 font-sans">
              <span class="text-secondary-300 font-mono text-base block mt-2 mb-2">
                <AlternativelyTyping
                  alternatives={[
                    "Let us debug your NextJS app maybe?",
                    "Let us pass an interview for you?",
                    "Let us give you a guided tour?",
                    "Let us take you on a pub crawl in Skopje?",
                    "(((Let us teach you Lisp?)))",
                    "Let us fix your TS types?",
                    "Would you be interested in a stack of pancakes?",
                    "Let us hide your colleague's Jira tickets?",
                    "Let us convince your manager for additional PTO so you can enjoy Skopje?",
                    "Let us refactor your legacy codebase?",
                    "Let us optimize your database queries?",
                    "Let us automate your workflow?",
                    "Let us create some custom emojis for your Slack?",
                    "Let us help you ace that coding challenge?",
                    "Let us review your pull requests?",
                    "Let us help you with your open source contributions?",
                    "How about a deep dive into functional programming?",
                    "Let us create a meme for your team?",
                    "Let us help you master regular expressions?",
                    "How about a lesson in Docker?",
                    "Let us set up your CI/CD pipeline?",
                    "Let us explain why tabs are better than spaces?",
                    "Let us explain why spaces are better than tabs?",
                    "Let us teach your rubber duck some new debugging tricks?",
                    "Let us convince your PM that 'it works on my machine' is valid?",
                    "Let us translate your Stack Overflow answers from sarcasm?",
                    "Let us help you name your variables better than 'foo' and 'bar'?",
                    "Let us explain to your cat why the red dot isn't a bug?",
                    "Let us help you escape vim... again?",
                    "Let us organize your 147 open browser tabs?",
                    "Let us explain why your coffee machine should be microservices-based?",
                    "Let us help you find that semicolon you missed 3 hours ago?",
                  ]}
                ></AlternativelyTyping>
              </span>
              <br />
              Will that help? :D <br />
              <span class="text-xl font-bold text-white mt-2 block">
                Cool? Cool. See you on September 19th 🍻
              </span>
            </p>

            <div class="text-center mt-16 fade-in-delay-4 flex justify-center">
              <HologramButton
                href="/tickets"
                text="Grab your tickets"
                class="px-8 py-3 text-xl h-auto"
              />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
