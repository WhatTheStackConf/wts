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
            About WhatTheStack
          </h1>

          <div class="bg-base-300/90 backdrop-blur-md border border-primary-500/30 rounded-lg p-8 mb-8 fade-in-delay-1 grid-scan shadow-2xl relative z-30">
            <h2 class="text-2xl font-star text-primary-400 mb-4 tracking-wide shadow-black drop-shadow-md">
              A by-developers, for-developers event in the heart of Skopje in
              September 19th, 2026
            </h2>
            <p class="text-lg text-gray-200 mb-6 leading-relaxed font-sans">
              Most of us in this game tend to be on the wallflower side of
              the spectrum. Still, you can't deny the (very obvious) benefits of
              having a community to support and cheer for you.
            </p>

            <p class="text-lg text-gray-200 mb-6 leading-relaxed font-sans">
              What The Stack, for us, is the culmination of combined 20 years of
              community building efforts. We love going to conferences, meeting
              new people, learning new things...but sometimes, we get this
              feeling that these kinds of events are starting to get a bit too
              formal for our community culture. That's why we decided to make
              our own conference with blackjack and...Ha, got you. We decided to
              make a conference that won't be just ours. A conference that will
              be made by the passion of all the people who will attend What The
              Stack? So, hackers, developers, platform engineers, AI researchers, startup founders,
              and whatever title you choose (or may have been chosen for you)...
              welcome.
            </p>

            <p class="text-lg text-gray-200 mb-6 leading-relaxed font-sans">
              What The Stack is a conference. Surprising, we know. More
              importantly, it's a single-day, multi-track event that aims to
              celebrate technology, the web platform, AI, infrastructure and
              everything else that makes the modern stack what it is. It's never going to
              be the kind that expects a dress code of you. It's also{" "}
              <em class="text-primary-400 not-italic font-bold">stacked</em> with (pun very much intended) with authentic
              experiences, which may involve, but are not limited to:
            </p>

            <ul class="space-y-3 mb-6 text-lg text-gray-200 font-sans">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong class="text-white">Epic talks</strong> - And not just by the big names,
                  but the folks who genuinely love the craft. Expect
                  authentic, genuine insights on the entire spectrum from
                  familiar faces you know from the internet and newcomers alike
                  (which you'll probably know on the internet in a few years
                  anyway).
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong class="text-white">Coffee</strong> - yes, we have it. Yes it's good.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong class="text-white">Beers and Chill</strong>: Because let's face it, the
                  best ideas sometimes come over a cold brew (and we mean beer
                  this time).
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong class="text-white">Gourmet Grub</strong>: C'mon, it's the Balkans. We
                  know how to do food. Trust us, you'll try it and love it.
                  You'll be back.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong class="text-white">Community Vibes</strong>: This is where you'll find
                  your tribe. Whether you're flying solo or rolling with your
                  crew, you're among friends here. We're all about the vibes.
                </span>
              </li>
            </ul>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-8 fade-in-delay-3 shadow-[0_0_10px_rgba(var(--color-primary-500),0.5)]"></div>

            <h3 class="text-2xl font-bold text-white mb-4 fade-in-delay-3 tracking-wide font-mono">
              So what?
            </h3>
            <p class="text-lg text-gray-200 mb-4 font-sans">
              The ultimate goal for What The Stack is to become your yearly
              go-to conference. Since we're not we're not in the business of{" "}
              <code class="bg-base-100 px-2 py-0.5 rounded text-secondary-300 border border-secondary-500/30">Promise</code>s (pun also
              very much intended), here's what we'll deliver:
            </p>
            <ul class="space-y-3 mb-6 text-lg text-gray-200 font-sans">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>The epic talks mentioned above</span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>Coffee, beer, amazing food</span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>Great community and even better vibes</span>
              </li>
            </ul>

            <p class="text-lg text-gray-200 mb-4 font-sans">
              ... wait, you're still not convinced? Okay, fair enough. Shoot us
              a message at{" "}
              <a
                href="mailto:what@wts.rocks"
                class="text-primary-400 hover:text-primary-300 hover:underline font-bold transition-colors"
              >
                what@wts.rocks
              </a>{" "}
              or on any of our social media profiles.
            </p>

            <p class="text-lg text-gray-200 mb-6 font-sans">
              Alternatively: <br />
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
              <span class="text-xl font-bold text-white mt-2 block">Cool? Cool. See you on September 19th 🍻</span>
            </p>

            <div class="text-center mt-8 fade-in-delay-4">
              <a
                href="/tickets"
                class="btn btn-primary px-8 py-3 font-star tracking-wider text-base-100 hover:bg-primary-600 transition-all duration-300 neon-glow hover-pulse text-xl"
              >
                Grab your tickets
              </a>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
