import { Link } from "@solidjs/meta";
import { Layout } from "~/layouts/Layout";
import { toAbsoluteUrl } from "~/lib/site-url";

const OPEN_CODE_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "wts-conference-guide": {
      "type": "remote",
      "url": "https://wts.sh/api/mcp/public",
      "enabled": true
    }
  }
}`;

const INSPECTOR_COMMAND = `npx -y @modelcontextprotocol/inspector --cli \\
  https://wts.sh/api/mcp/public \\
  --transport http \\
  --method tools/call \\
  --tool-name search_sessions \\
  --tool-arg query=systems`;

const INSPECTOR_PLAN_COMMAND = `npx -y @modelcontextprotocol/inspector --cli \\
  https://wts.sh/api/mcp/public \\
  --transport http \\
  --method tools/call \\
  --tool-name plan_proposed_schedule \\
  --tool-arg 'ranked_session_slugs=["session-slug-a","session-slug-b"]' \\
  --tool-arg 'must_attend_slugs=["session-slug-a"]'`;

const INSPECTOR_PROMPT_COMMAND = `npx -y @modelcontextprotocol/inspector --cli \\
  https://wts.sh/api/mcp/public \\
  --transport http \\
  --method prompts/get \\
  --prompt-name compare_sessions \\
  --prompt-args session_slugs=session-slug-a,session-slug-b`;

const sectionClasses = "border-t border-white/15 py-10 md:py-14";

export default function McpConferenceGuidePage() {
  const endpoint = toAbsoluteUrl("/api/mcp/public");

  return (
    <Layout
      title="Public MCP Conference Guide | WhatTheStack 2026"
      description="Connect an MCP client to the anonymous WhatTheStack Conference Guide for validated logistics and the current Published programme."
      ogSubtitle="Public Conference Guide for MCP clients"
    >
      <Link rel="canonical" href={toAbsoluteUrl("/mcp")} />
      <article class="w-full px-4 pb-16 pt-8 md:px-6 md:pb-24 md:pt-16">
        <div class="mx-auto max-w-5xl">
          <header class="max-w-3xl pb-10 md:pb-14">
            <p class="speaker-kicker mb-4">Public conference interface</p>
            <h1 class="max-w-3xl text-balance font-star text-4xl font-bold leading-tight text-secondary-300 md:text-6xl">
              Conference Guide for MCP clients
            </h1>
            <p class="mt-6 max-w-[70ch] text-pretty text-lg leading-8 text-base-content/85">
              Connect without an account or token. The Guide gives compatible clients a narrow,
              versioned view of validated attendee logistics and the current Published conference programme.
            </p>
          </header>

          <section aria-labelledby="endpoint-heading" class="border-y border-primary-500/45 bg-base-200/75 px-5 py-6 md:px-8 md:py-8">
            <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div class="min-w-0">
                <h2 id="endpoint-heading" class="text-xl font-bold text-white">Public Streamable HTTP endpoint</h2>
                <p class="mt-2 max-w-[65ch] text-sm leading-6 text-base-content/75">
                  Do not add headers or credentials. Any supplied <code class="font-mono text-secondary-300">Authorization</code> header is rejected.
                </p>
              </div>
              <span class="w-fit border border-success/50 bg-success/10 px-3 py-1.5 font-mono text-xs font-bold text-success">
                Anonymous · read-only
              </span>
            </div>
            <div class="mt-5 max-w-full overflow-x-auto border border-white/15 bg-black/45 p-4">
              <code class="block min-w-max select-all font-mono text-sm text-accent-300">{endpoint}</code>
            </div>
          </section>

          <section aria-labelledby="connect-heading" class={sectionClasses}>
            <h2 id="connect-heading" class="text-3xl font-bold text-white">Connect a verified client</h2>
            <p class="mt-3 max-w-[70ch] leading-7 text-base-content/75">
              The configurations below are smoke-tested for this endpoint. They intentionally contain no token or authorization header.
            </p>
            <div class="mt-8 space-y-10">
              <figure>
                <figcaption class="mb-3 text-lg font-bold text-secondary-300">OpenCode</figcaption>
                <p class="mb-4 max-w-[70ch] text-sm leading-6 text-base-content/70">
                  Add this remote server to <code class="font-mono text-base-content">opencode.json</code>, then restart OpenCode.
                </p>
                <pre tabindex="0" class="max-w-full overflow-x-auto border border-white/15 bg-black/55 p-5 text-sm leading-6 text-base-content"><code>{OPEN_CODE_CONFIG}</code></pre>
              </figure>
              <figure>
                <figcaption class="mb-3 text-lg font-bold text-secondary-300">MCP Inspector</figcaption>
                <p class="mb-4 max-w-[70ch] text-sm leading-6 text-base-content/70">
                  Search first to obtain current public slugs, then pass those slugs to the planner. Use <code class="font-mono text-base-content">resources/list</code>, <code class="font-mono text-base-content">tools/list</code>, and <code class="font-mono text-base-content">prompts/list</code> for discovery.
                </p>
                <pre tabindex="0" class="max-w-full overflow-x-auto border border-white/15 bg-black/55 p-5 text-sm leading-6 text-base-content"><code>{INSPECTOR_COMMAND}</code></pre>
                <p class="mb-3 mt-5 max-w-[70ch] text-sm leading-6 text-base-content/70">
                  Replace the placeholder slugs with search results. Add the Agenda's current <code class="font-mono text-base-content">programme_version</code> as <code class="font-mono text-base-content">prior_programme_version</code> when checking for changes.
                </p>
                <pre tabindex="0" class="max-w-full overflow-x-auto border border-white/15 bg-black/55 p-5 text-sm leading-6 text-base-content"><code>{INSPECTOR_PLAN_COMMAND}</code></pre>
                <p class="mb-3 mt-5 max-w-[70ch] text-sm leading-6 text-base-content/70">
                  Retrieve the comparison workflow as an MCP prompt. The compatible client performs the reasoning and tool calls.
                </p>
                <pre tabindex="0" class="max-w-full overflow-x-auto border border-white/15 bg-black/55 p-5 text-sm leading-6 text-base-content"><code>{INSPECTOR_PROMPT_COMMAND}</code></pre>
              </figure>
            </div>
          </section>

          <section aria-labelledby="resources-heading" class={sectionClasses}>
            <h2 id="resources-heading" class="text-3xl font-bold text-white">What the Guide exposes</h2>
            <dl class="mt-8 divide-y divide-white/10 border-y border-white/10">
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">Guide index</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">Validated logistics, explicit unknowns, programme status, public slugs, and links to the detailed resources.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">Published Agenda</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">Published Conference Days and Agenda Slots with stable Day and Track keys and local times in Europe/Skopje.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">Session / Speaker</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">One Published Session or Speaker selected by the same public slug used on the website.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">Published Partners</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">Published Partner names, classifications, tiers, and validated public website links. Partner Notes are never included.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">search_sessions</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">Deterministic text search with a 1-160 character query and at most 20 results across Published Session titles and abstracts, public Speaker names and affiliations, formats, Tracks, and locations. Optional date, format, Track, Speaker, and location filters are exact and case-insensitive.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">plan_proposed_schedule</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0">Plans only from current Published Sessions with Published Agenda Slots. Accepts ranked, must-attend, and excluded public slugs, Europe/Skopje availability windows, and an optional prior programme version. Results contain non-overlapping selected Sessions, fixed all-attendee Slots, unresolved hard constraints, conflict reasons, and alternatives.</dd>
              </div>
              <div class="py-5 md:grid md:grid-cols-[13rem_1fr] md:gap-8">
                <dt class="font-mono text-sm font-bold text-accent-300">Public prompts</dt>
                <dd class="mt-2 leading-7 text-base-content/80 md:mt-0"><code class="font-mono text-sm">plan_conference_day</code> and <code class="font-mono text-sm">compare_sessions</code> guide compatible clients through resources, search, and planning. They return workflow instructions; they do not invoke a WTS-hosted LLM.</dd>
              </div>
            </dl>
            <p class="mt-6 text-sm leading-6 text-base-content/70">
              Human-readable sources: <a class="link text-primary-300" href="/agenda">Agenda</a>,{" "}
              <a class="link text-primary-300" href="/sessions">Sessions</a>,{" "}
              <a class="link text-primary-300" href="/speakers">Speakers</a>, and{" "}
              <a class="link text-primary-300" href="/sponsors">Partners</a>.
            </p>
          </section>

          <section aria-labelledby="boundary-heading" class={sectionClasses}>
            <h2 id="boundary-heading" class="text-3xl font-bold text-white">Public boundary and limitations</h2>
            <div class="mt-7 grid gap-8 md:grid-cols-2 md:gap-12">
              <div>
                <h3 class="text-lg font-bold text-secondary-300">Included</h3>
                <ul class="mt-4 list-disc space-y-3 pl-5 leading-7 text-base-content/80 marker:text-accent-400">
                  <li>Deploy-validated conference facts and explicit <code class="font-mono text-sm">not_announced</code> states.</li>
                  <li>Current Published Agenda, Sessions, Speakers, and Partners.</li>
                  <li>Bounded Session search with matched fields, plain-text snippets, canonical Session and Speaker links, and transparent ranking signals.</li>
                  <li>Ephemeral Proposed Schedules based only on caller priorities and schedule fit, with fixed all-attendee context and explicit trade-offs.</li>
                  <li>Client-side planning and comparison prompt workflows.</li>
                  <li>Plain text, canonical website links, stable public keys, and content/programme versions.</li>
                </ul>
              </div>
              <div>
                <h3 class="text-lg font-bold text-secondary-300">Excluded or deferred</h3>
                <ul class="mt-4 list-disc space-y-3 pl-5 leading-7 text-base-content/80 marker:text-primary-400">
                  <li>Drafts, PocketBase IDs, publication flags, raw storage timestamps, or Speaker origin.</li>
                  <li>CFP provenance, submissions, reviews, Partner Notes, Admin Actions, or administrative tools.</li>
                  <li>Saved schedules, User schedule collections, reservations, capacity, waitlists, calendar export, and attendance guarantees.</li>
                  <li>Attendee authentication, behavioral recommendations, and ranking from sponsorship, Speaker origin, CFP/review data, internal scores, prestige, popularity, publication order, or editorial boosts.</li>
                </ul>
              </div>
            </div>
            <aside class="mt-9 border border-warning/45 bg-warning/10 p-5 text-sm leading-6 text-warning-content md:p-6">
              MCP clients generate their own answers from this data. WhatTheStack does not run an LLM, hosted model, or embedding search for this endpoint. Conference copy is returned as data, not instructions. Verify time-sensitive details through the canonical links before relying on them.
            </aside>
          </section>

          <section aria-labelledby="accuracy-heading" class={sectionClasses}>
            <h2 id="accuracy-heading" class="text-3xl font-bold text-white">Accuracy and outage states</h2>
            <div class="mt-6 max-w-[72ch] space-y-4 leading-7 text-base-content/80">
              <p><code class="font-mono text-sm text-secondary-300">not_announced</code> means organizers have not published that logistics fact. It is not permission to infer or guess a value.</p>
              <p><code class="font-mono text-sm text-secondary-300">programme_unavailable</code> means the live Published programme could not be loaded. Static logistics remain readable, while programme resources fail clearly rather than extending expired cached data.</p>
              <p>Every successful resource, Session search, and Proposed Schedule reports the deploy-content version, live programme version, generation time, canonical URL, and <code class="font-mono text-sm">Europe/Skopje</code>. A supplied older programme version is reported as changed; the planner uses only current Published facts.</p>
              <p>Missing or unpublished, unscheduled, excluded, unavailable, malformed, overlong, duplicate, and mutually conflicting inputs produce bounded explicit outcomes rather than inferred replacements. Invalid calls distinguish <code class="font-mono text-sm">malformed_arguments</code>, <code class="font-mono text-sm">overlong_arguments</code>, and <code class="font-mono text-sm">duplicate_arguments</code>. Equal must-attend conflicts use stable Published Agenda order, disclose the tie-break, and return the rejected choice as an equal alternative.</p>
            </div>
          </section>

          <section aria-labelledby="privacy-heading" class={sectionClasses}>
            <h2 id="privacy-heading" class="text-3xl font-bold text-white">Endpoint privacy</h2>
            <div class="mt-6 max-w-[72ch] space-y-4 leading-7 text-base-content/80">
              <p>Public MCP request bodies, resource choices, Session query text, filters, planner priorities, exclusions, availability windows, and results are processed in memory and are not retained as User state, request logs, or behavioral analytics. The endpoint does not set a visitor identity, fingerprint clients, or create public API keys.</p>
              <p>Operations may contribute to aggregate service metrics. Abuse protection uses only short-lived in-memory counters, including a salted per-IP burst counter when the deployment supplies a trusted client address, plus global rate and concurrency limits.</p>
              <p>Capacity responses use HTTP <code class="font-mono text-sm">429</code> with <code class="font-mono text-sm">Retry-After</code>. The counters expire automatically and are not added to attendee profiles or Admin Actions.</p>
            </div>
          </section>

          <section aria-labelledby="examples-heading" class={sectionClasses}>
            <h2 id="examples-heading" class="text-3xl font-bold text-white">Example questions</h2>
            <ul class="mt-7 space-y-4 text-lg leading-7 text-base-content/85">
              <li class="border-b border-white/10 pb-4">“What has WhatTheStack announced about the main venue and accessibility?”</li>
              <li class="border-b border-white/10 pb-4">“What is on the current Published Agenda in local Skopje time?”</li>
              <li class="border-b border-white/10 pb-4">“Search Published Sessions for systems reliability on the Systems Track, explain which public fields matched, and link me to each Session and Speaker.”</li>
              <li class="border-b border-white/10 pb-4">“Plan my conference day: rank these Sessions, treat this one as must-attend, exclude that one, and explain every schedule conflict and alternative.”</li>
              <li class="border-b border-white/10 pb-4">“Compare these two Sessions using their public content and my availability, then disclose whether the programme changed.”</li>
              <li>“Which conference Partners are currently Published?”</li>
            </ul>
          </section>
        </div>
      </article>
    </Layout>
  );
}
