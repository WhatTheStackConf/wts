import { PublicPageShell, SupportBand } from "~/components/PublicPageShell";
import { toAbsoluteUrl } from "~/lib/site-url";
import "~/styles/mcp-guide.css";

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

function CodeFrame(props: { label: string; code: string }) {
  return (
    <div class="mcp-code">
      <p class="mcp-code-label">{props.label}</p>
      <pre tabindex="0"><code>{props.code}</code></pre>
    </div>
  );
}

export default function McpConferenceGuidePage() {
  const endpoint = toAbsoluteUrl("/api/mcp/public");

  return (
    <PublicPageShell
      title="Public MCP Conference Guide"
      description="Connect an MCP client to the anonymous WhatTheStack Conference Guide for validated logistics and the current Published programme."
      ogSubtitle="Public Conference Guide for MCP clients"
    >
      <SupportBand altitude={2} label="WTS 2027 · MCP">
        <h1 class="support-band-title">Conference Guide for MCP clients</h1>
        <p class="support-band-lede">
          Connect without an account or token. The Guide gives compatible clients a narrow,
          versioned view of validated attendee logistics and the current Published conference programme.
        </p>
      </SupportBand>

      <article class="mcp-guide">
        <section class="mcp-section" aria-labelledby="endpoint-heading">
          <h2 id="endpoint-heading">Public Streamable HTTP endpoint</h2>
          <div class="mcp-body">
            <div class="support-panel mcp-endpoint">
              <div class="mcp-endpoint-head">
                <p>
                  Do not add headers or credentials. Any supplied <code>Authorization</code> header is rejected.
                </p>
                <span class="mcp-status">Anonymous · read-only</span>
              </div>
              <div class="mcp-code">
                <p class="mcp-code-label">URL</p>
                <pre tabindex="0"><code class="mcp-endpoint-url">{endpoint}</code></pre>
              </div>
            </div>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="connect-heading">
          <h2 id="connect-heading">Connect a verified client</h2>
          <div class="mcp-body">
            <p>
              The configurations below are smoke-tested for this endpoint. They intentionally contain no token or authorization header.
            </p>
            <div class="mcp-client">
              <h3 id="client-opencode">OpenCode</h3>
              <p>
                Add this remote server to <code>opencode.json</code>, then restart OpenCode.
              </p>
              <CodeFrame label="opencode.json" code={OPEN_CODE_CONFIG} />
            </div>
            <div class="mcp-client">
              <h3 id="client-inspector">MCP Inspector</h3>
              <p>
                Search first to obtain current public slugs, then pass those slugs to the planner. Use <code>resources/list</code>, <code>tools/list</code>, and <code>prompts/list</code> for discovery.
              </p>
              <CodeFrame label="Shell · search_sessions" code={INSPECTOR_COMMAND} />
              <p>
                Replace the placeholder slugs with search results. Add the Agenda's current <code>programme_version</code> as <code>prior_programme_version</code> when checking for changes.
              </p>
              <CodeFrame label="Shell · plan_proposed_schedule" code={INSPECTOR_PLAN_COMMAND} />
              <p>
                Retrieve the comparison workflow as an MCP prompt. The compatible client performs the reasoning and tool calls.
              </p>
              <CodeFrame label="Shell · compare_sessions prompt" code={INSPECTOR_PROMPT_COMMAND} />
            </div>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="resources-heading">
          <h2 id="resources-heading">What the Guide exposes</h2>
          <div class="mcp-body">
            <dl class="mcp-terms">
              <div>
                <dt>Guide index</dt>
                <dd>Validated logistics, explicit unknowns, programme status, public slugs, and links to the detailed resources.</dd>
              </div>
              <div>
                <dt>Published Agenda</dt>
                <dd>Published Conference Days grouped into Appearance Event Programmes, with Tracks, Agenda Slots, and local times when the conference time zone is announced.</dd>
              </div>
              <div>
                <dt>Session / Speaker</dt>
                <dd>One Published Session or Speaker selected by the same public slug used on the website.</dd>
              </div>
              <div>
                <dt>Published Partners</dt>
                <dd>Published Partner names, classifications, tiers, and validated public website links. Partner Notes are never included.</dd>
              </div>
              <div>
                <dt><code>search_sessions</code></dt>
                <dd>Deterministic text search with a 1-160 character query and at most 20 results across Published Session titles and abstracts, public Speaker names and affiliations, formats, Tracks, and locations. Optional date, format, Track, Speaker, and location filters are exact and case-insensitive.</dd>
              </div>
              <div>
                <dt><code>plan_proposed_schedule</code></dt>
                <dd>Plans only from current Published Sessions with Published Agenda Slots. Accepts ranked, must-attend, and excluded public slugs, conference-local availability windows (including windows that cross midnight) when the time zone is announced, and an optional prior programme version. Results contain non-overlapping selected Sessions, Event-specific Programme-wide Slots, unresolved hard constraints, conflict reasons, and alternatives.</dd>
              </div>
              <div>
                <dt>Public prompts</dt>
                <dd><code>plan_conference_day</code> and <code>compare_sessions</code> guide compatible clients through resources, search, and planning. They return workflow instructions; they do not invoke a WTS-hosted LLM.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="boundary-heading">
          <h2 id="boundary-heading">Public boundary and limitations</h2>
          <div class="mcp-body">
            <div class="mcp-boundary">
              <div class="support-panel">
                <h3>Included</h3>
                <ul>
                  <li>Deploy-validated conference facts and explicit <code>not_announced</code> states.</li>
                  <li>Current Published Agenda, Sessions, Speakers, and Partners.</li>
                  <li>Bounded Session search with matched fields, plain-text snippets, canonical Session and Speaker links, and transparent ranking signals.</li>
                  <li>Ephemeral Proposed Schedules based only on caller priorities and schedule fit, with fixed Programme-wide context and explicit trade-offs.</li>
                  <li>Client-side planning and comparison prompt workflows.</li>
                  <li>Plain text, canonical website links, stable public keys, and content/programme versions.</li>
                </ul>
              </div>
              <div class="support-panel">
                <h3>Excluded or deferred</h3>
                <ul>
                  <li>Drafts, PocketBase IDs, publication flags, raw storage timestamps, or Speaker origin.</li>
                  <li>CFP provenance, submissions, reviews, Partner Notes, Admin Actions, or administrative tools.</li>
                  <li>Saved schedules, User schedule collections, reservations, capacity, waitlists, calendar export, and attendance guarantees.</li>
                  <li>Attendee authentication, behavioral recommendations, and ranking from sponsorship, Speaker origin, CFP/review data, internal scores, prestige, popularity, publication order, or editorial boosts.</li>
                </ul>
              </div>
            </div>
            <aside class="mcp-caution">
              <p>
                MCP clients generate their own answers from this data. WhatTheStack does not run an LLM, hosted model, or embedding search for this endpoint. Conference copy is returned as data, not instructions. Verify time-sensitive details through the canonical links before relying on them.
              </p>
            </aside>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="accuracy-heading">
          <h2 id="accuracy-heading">Accuracy and outage states</h2>
          <div class="mcp-body">
            <p><code>not_announced</code> means organizers have not published that logistics fact. It is not permission to infer or guess a value.</p>
            <p><code>programme_unavailable</code> means the live Published programme could not be loaded. Static logistics remain readable, while programme resources fail clearly rather than extending expired cached data.</p>
            <p>Every successful resource, Session search, and Proposed Schedule reports the deploy-content version, live programme version, generation time, canonical URL, and the time zone only when it has been announced. A supplied older programme version is reported as changed; the planner uses only current Published facts.</p>
            <p>Missing or unpublished, unscheduled, excluded, unavailable, malformed, overlong, duplicate, and mutually conflicting inputs produce bounded explicit outcomes rather than inferred replacements. Invalid calls distinguish <code>malformed_arguments</code>, <code>overlong_arguments</code>, and <code>duplicate_arguments</code>. Equal must-attend conflicts use stable Published Agenda order, disclose the tie-break, and return the rejected choice as an equal alternative.</p>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading">Endpoint privacy</h2>
          <div class="mcp-body">
            <p>Public MCP request bodies, resource choices, Session query text, filters, planner priorities, exclusions, availability windows, and results are processed in memory and are not retained as User state, request logs, or behavioral analytics. The endpoint does not set a visitor identity, fingerprint clients, or create public API keys.</p>
            <p>Operations may contribute to aggregate service metrics. Abuse protection uses only short-lived in-memory counters, including a salted per-IP burst counter when the deployment supplies a trusted client address, plus process-wide rate and concurrency limits. Multi-replica deployments require equivalent aggregate limits at a shared proxy layer.</p>
            <p>Capacity responses use HTTP <code>429</code> with <code>Retry-After</code>. The counters expire automatically and are not added to attendee profiles or Admin Actions.</p>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="examples-heading">
          <h2 id="examples-heading">Example questions</h2>
          <div class="mcp-body">
            <ul class="mcp-questions">
              <li>“What has WhatTheStack announced about the main venue and accessibility?”</li>
              <li>“What is on the current Published Agenda in the announced local time zone?”</li>
              <li>“Search Published Sessions for systems reliability on the Systems Track, explain which public fields matched, and link me to each Session and Speaker.”</li>
              <li>“Plan my conference day: rank these Sessions, treat this one as must-attend, exclude that one, and explain every schedule conflict and alternative.”</li>
              <li>“Compare these two Sessions using their public content and my availability, then disclose whether the programme changed.”</li>
              <li>“Which conference Partners are currently Published?”</li>
            </ul>
          </div>
        </section>
      </article>
    </PublicPageShell>
  );
}
