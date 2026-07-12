import { clientOnly } from "@solidjs/start";
import { Icon } from "@iconify-icon/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { Layout } from "~/layouts/Layout";
import type { GamificationPublicOpsBoardPage } from "~/lib/gamification";
import { getPublicOpsBoard } from "~/lib/gamification-profile";

const OpsBoardPage = () => {
  const [page, setPage] = createSignal(1);
  const [board, { refetch }] = createResource(page, (currentPage) => getPublicOpsBoard(currentPage, 50));
  const rows = () => board()?.items || [];

  return (
    <Layout title="Ops Board // WhatTheStack" description="Public WhatTheStack field progress rankings">
      <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
        <div class="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-primary-900/20 blur-[120px] -z-10 pointer-events-none" />
        <div class="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-secondary-900/20 blur-[120px] -z-10 pointer-events-none" />

        <div class="container mx-auto px-4 sm:px-6 md:max-w-5xl">
          <header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p class="font-mono text-xs uppercase tracking-[0.14em] text-primary-300">Public field progress</p>
              <h1 class="mt-2 text-4xl font-star text-transparent bg-clip-text bg-gradient-to-r from-white via-primary-200 to-secondary-200 sm:text-5xl">OPS BOARD</h1>
              <p class="mt-3 max-w-2xl text-sm leading-relaxed text-secondary-200/80">
                Ranks use Leaderboard XP only. Agents can opt out or hide Badge snippets from their profile at any time.
              </p>
              <p class="mt-2 max-w-2xl text-xs leading-relaxed text-secondary-300/75">
                Equal Leaderboard XP totals share the same rank. No private activity, total XP, time, or Badge count breaks a tie.
              </p>
            </div>
            <button
              type="button"
              class={`btn btn-outline btn-primary min-h-12 font-mono ${board.loading ? "loading" : ""}`}
              disabled={board.loading}
              onClick={() => void refetch()}
            >
              Refresh board
            </button>
          </header>

          <Show
            when={!board.loading || board()}
            fallback={
              <div class="glass-panel flex min-h-56 items-center justify-center rounded-2xl border border-white/10 p-8" role="status">
                <span class="loading loading-bars loading-lg text-primary" aria-hidden="true" />
                <span class="ml-3 font-mono text-sm text-secondary-200">Loading public field progress...</span>
              </div>
            }
          >
            <Show
              when={!board.error}
              fallback={
                <div class="alert alert-error flex-col items-start sm:flex-row sm:items-center sm:justify-between" role="alert">
                  <span>Public field progress could not be loaded. No private or stale rows are being shown.</span>
                  <button type="button" class="btn btn-sm btn-outline min-h-11 font-mono" disabled={board.loading} onClick={() => void refetch()}>Try again</button>
                </div>
              }
            >
              <Show
                when={rows().length > 0}
                fallback={
                  <div class="glass-panel rounded-2xl border border-dashed border-white/15 p-10 text-center">
                    <Icon icon="material-symbols:radar" class="mx-auto text-5xl text-primary-300" aria-hidden="true" />
                    <h2 class="mt-4 text-xl font-star text-white">No public agents yet</h2>
                    <p class="mt-2 text-sm leading-relaxed text-secondary-200/80">Public progress will appear here after agents choose to remain visible on the ops board.</p>
                  </div>
                }
              >
                <section class="glass-panel overflow-hidden rounded-2xl border border-white/10" aria-labelledby="ops-board-results-heading" aria-busy={board.loading}>
                  <h2 id="ops-board-results-heading" class="sr-only">Ops-board rankings</h2>
                  <Show when={board.loading}><p class="sr-only" role="status">Updating public field progress...</p></Show>
                  <div class="grid gap-3 p-3 md:hidden" role="list">
                   <For each={rows()}>
                    {(row) => (
                      <article class="rounded-xl border border-white/10 bg-base-300/35 p-4" role="listitem">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <p class="font-mono text-sm font-bold text-primary-300">Rank {row.rank}</p>
                            <h3 class="mt-1 break-words text-lg font-bold text-white">{row.displayName}</h3>
                            <p class="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-secondary-200">Access Level {row.accessLevel}</p>
                          </div>
                          <div class="shrink-0 text-right">
                            <p class="text-2xl font-star text-white">{row.leaderboardXp}</p>
                            <p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-secondary-300/75">Leaderboard XP</p>
                          </div>
                        </div>
                        <p class="mt-4 font-mono text-xs text-secondary-200">Public Badges: {row.publicBadgeCount}</p>
                        <Show when={row.badges.length > 0}>
                          <ul class="mt-2 flex flex-wrap gap-2" role="list">
                            <For each={row.badges}>
                              {(badge) => <li class="badge badge-outline border-primary-400/35 text-primary-100">{badge.name}</li>}
                            </For>
                          </ul>
                        </Show>
                      </article>
                    )}
                  </For>
                  </div>

                  <div class="hidden overflow-x-auto md:block">
                  <table class="table table-lg w-full">
                    <caption class="sr-only">Public agents ranked by Leaderboard XP</caption>
                    <thead>
                      <tr class="border-b border-white/10 bg-white/5 text-white">
                        <th scope="col" class="font-mono text-primary-200">RANK</th>
                        <th scope="col" class="font-mono text-primary-200">AGENT</th>
                        <th scope="col" class="font-mono text-primary-200">ACCESS LEVEL</th>
                        <th scope="col" class="text-right font-mono text-primary-200">LEADERBOARD XP</th>
                        <th scope="col" class="font-mono text-primary-200">PUBLIC BADGES</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={rows()}>
                        {(row) => (
                          <tr class="border-b border-white/5 transition-colors hover:bg-white/5">
                            <th scope="row" class="font-mono text-lg text-primary-300">{row.rank}</th>
                            <td class="max-w-56 break-words font-bold text-white">{row.displayName}</td>
                            <td class="font-mono text-secondary-100">Access Level {row.accessLevel}</td>
                            <td class="text-right font-mono text-lg font-bold text-white">{row.leaderboardXp}</td>
                            <td>
                              <p class="font-mono text-xs text-secondary-200">{row.publicBadgeCount} public</p>
                              <Show when={row.badges.length > 0}>
                                <ul class="mt-2 flex flex-wrap gap-2" role="list">
                                  <For each={row.badges}>
                                    {(badge) => <li class="badge badge-outline border-primary-400/35 text-primary-100">{badge.name}</li>}
                                  </For>
                                </ul>
                              </Show>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                  </div>
                </section>
                <nav class="mt-4 flex items-center justify-between gap-3" aria-label="Ops-board pages">
                <button
                  type="button"
                  class="btn btn-outline btn-primary min-h-12 font-mono"
                  disabled={board.loading || page() <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous page
                </button>
                <p class="font-mono text-xs text-secondary-200" aria-live="polite">
                  Page {board()?.page || page()} of {board()?.totalPages || 1}
                </p>
                <button
                  type="button"
                  class="btn btn-outline btn-primary min-h-12 font-mono"
                  disabled={board.loading || page() >= (board()?.totalPages || 1)}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next page
                </button>
                </nav>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </Layout>
  );
};

export default clientOnly(async () => ({ default: OpsBoardPage }), { lazy: true });
