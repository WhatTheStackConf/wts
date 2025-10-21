import { Layout } from "../layouts/Layout";
import CodeBackground from "~/components/CodeBackground";
import AlternativelyTyping from "~/components/AlternativelyTyping";

export default function About() {
  return (
    <Layout
      title="About WhatTheStack 2026"
      description="Learn more about the future of web development"
    >
      <div class="w-full h-full px-4 py-16 relative">
        <CodeBackground />
        <div class="absolute inset-0 scanline z-10"></div>
        <div class="max-w-4xl mx-auto relative z-20">
          <h1 class="text-4xl md:text-5xl font-star font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-500 to-secondary-300 mb-8 text-center neon-glow fade-in">
            About WhatTheStack
          </h1>

          <div class="bg-base-200/70 backdrop-blur-sm border border-primary-500/30 rounded-lg p-8 mb-8 fade-in-delay-1 grid-scan">
            <h2 class="text-2xl font-star text-primary-500 mb-4">
              A by-developers, for-developers event in the heart of Skopje in
              September 2026
            </h2>
            <p class="text-lg text-secondary-300 mb-6">
              Most of us in the webdev game tend to be on the wallflower side of
              the spectrum. Still, you can't deny the (very obvious) benefits of
              having a community to support and cheer for you.
            </p>

            <p class="text-lg text-secondary-300 mb-6">
              What The Stack, for us, is the culmination of combined 20 years of
              community building efforts. We love going to conferences, meeting
              new people, learning new things...but sometimes, we get this
              feeling that these kinds of events are starting to get a bit too
              formal for our community culture. That's why we decided to make
              our own conference with blackjack and...Ha, got you. We decided to
              make a conference that won't be just ours. A conference that will
              be made by the passion of all the people who will attend What The
              Stack? So, hackers, developers, programmers, software engineers,
              and whatever title you choose (or may have been chosen for you)...
              welcome.
            </p>

            <p class="text-lg text-secondary-300 mb-6">
              What The Stack is a conference. Surprising, we know. More
              importantly, it's a single-day, multi-track event that aims to
              celebrate web development, the web platform, web standards and
              everything else that makes webdev what it is. It's never going to
              be the kind that expects a dress code of you. It's also{" "}
              <em>stacked</em> with (pun very much intended) with authentic
              experiences, which may involve, but are not limited to:
            </p>

            <ul class="space-y-3 mb-6 text-lg text-secondary-300">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong>Epic talks</strong> - And not just by the big names
                  who webdev, but the folks who genuinely love the web. Expect
                  authentic, genuine insights on the entire spectrum from
                  familiar faces you know from the internet and newcomers alike
                  (which you'll probably know on the internet in a few years
                  anyway).
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong>Coffee</strong> - yes, we have it. Yes it's good.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong>Beers and Chill</strong>: Because let's face it, the
                  best ideas sometimes come over a cold brew (and we mean beer
                  this time).
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong>Gourmet Grub</strong>: C'mon, it's the Balkans. We
                  know how to do food. Trust us, you'll try it and love it.
                  You'll be back.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">•</span>
                <span>
                  <strong>Community Vibes</strong>: This is where you'll find
                  your tribe. Whether you're flying solo or rolling with your
                  crew, you're among friends here. We're all about the vibes.
                </span>
              </li>
            </ul>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-6 fade-in-delay-2"></div>

            <h3 class="text-2xl font-bold text-secondary-300 mb-4 fade-in-delay-2">
              Who are you people?
            </h3>
            <p class="text-lg text-secondary-300 mb-4">
              Glad you asked (it could have ended being awkward otherwise :D ).
            </p>
            <ul class="space-y-3 mb-6 text-lg text-secondary-300">
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">1.</span>
                <span>
                  <a
                    href="https://deved.mk"
                    class="text-primary-500 hover:underline"
                  >
                    <strong>DeveD</strong>
                  </a>{" "}
                  - We have a funny story on why we started an organization. We
                  needed an account so we can get sponsorships for our BeerJS
                  events. Thus, DeveD was born, an organization dedicated to
                  developer education and IT community building in our corner of
                  the world (plus, y'know, the beer helps). But, turns out,
                  having an organization opens the doors for more ambitious
                  pursuits. Such as, conferences. More importantly, What The
                  Stack.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">2.</span>
                <span>
                  <a
                    href="https://42.mk"
                    class="text-primary-500 hover:underline"
                  >
                    <strong>Base42</strong>
                  </a>{" "}
                  - We're a collective of passionate engineers and tinkerers
                  trying to bring the hacker culture to the Balkans, and make it
                  more mainstream. We're the folks behind Base42 the hackerspace
                  and 42.mk the organization whose primary goal it is to ignite
                  as many communities as possible and bring the tech industry
                  into the open both in source, presence and spirit.
                </span>
              </li>
              <li class="flex items-start">
                <span class="text-primary-500 mr-2 font-bold">3.</span>
                <span>
                  <a
                    href="https://angularmacedonia.org"
                    class="text-primary-500 hover:underline"
                  >
                    <strong>Angular Macedonia</strong>
                  </a>{" "}
                  - The Angular Macedonia community is a group of Angular
                  enthusiasts, dedicated to learning and collaboration,
                  regardless of experience level.
                </span>
              </li>
            </ul>

            <div class="h-1 w-24 bg-primary-500 mx-auto my-6 fade-in-delay-3"></div>

            <h3 class="text-2xl font-bold text-secondary-300 mb-4 fade-in-delay-3">
              So what?
            </h3>
            <p class="text-lg text-secondary-300 mb-4">
              The ultimate goal for What The Stack is to become your yearly
              go-to conference. Since we're not we're not in the business of{" "}
              <code class="bg-base-300 px-1 rounded">Promise</code>s (pun also
              very much intended), here's what we'll deliver:
            </p>
            <ul class="space-y-3 mb-6 text-lg text-secondary-300">
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

            <p class="text-lg text-secondary-300 mb-4">
              ... wait, you're still not convinced? Okay, fair enough. Shoot us
              a message at{" "}
              <a
                href="mailto:what@wts.rocks"
                class="text-primary-500 hover:underline"
              >
                what@wts.rocks
              </a>{" "}
              or on any of our social media profiles.
            </p>

            <p class="text-lg text-secondary-300 mb-6">
              Alternatively: <br />
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
              <br />
              Will that help? :D <br />
              Cool? Cool. See you in September 🍻
            </p>

            <div class="text-center mt-8 fade-in-delay-4">
              <a
                href="/tickets"
                class="btn btn-primary px-6 py-3 font-star tracking-wider text-base-100 hover:bg-primary-600 transition-all duration-300 neon-glow hover-pulse"
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
