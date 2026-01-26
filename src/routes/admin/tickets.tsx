import { createSignal, createResource, Show, For, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";
import { fetchHiEventsAttendees, HiEventsAttendee } from "~/lib/hievents";
import { getGravatarUrl } from "~/lib/gravatar";

export default function AdminTickets() {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = createSignal("");

    // Fetch attendees using existing server action
    const [attendees] = createResource(async () => {
        return await fetchHiEventsAttendees();
    });

    // Filter attendees based on search term
    const filteredAttendees = createMemo(() => {
        const data = attendees();
        if (!data) return [];

        const term = searchTerm().toLowerCase();
        if (!term) return data;

        return data.filter(a =>
            a.first_name?.toLowerCase().includes(term) ||
            a.last_name?.toLowerCase().includes(term) ||
            a.email?.toLowerCase().includes(term) ||
            a.ticket?.title?.toLowerCase().includes(term)
        );
    });

    const stats = createMemo(() => {
        const data = attendees() || [];
        const total = data.length;
        const checkedIn = data.filter(a => a.checked_in_at).length;
        const revenue = data.reduce((acc, curr) => acc + (curr.ticket?.price || 0), 0);
        return { total, checkedIn, revenue };
    });

    return (
        <Layout title="Ticket Management" description="Monitor event attendees">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Decorations */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-accent-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4 max-w-7xl">
                    <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
                        <div>
                            <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-accent-400 to-white uppercase drop-shadow-sm mb-2">Ticket Management</h1>
                            <p class="text-secondary-300 font-mono text-sm">ATTENDEE LIST & CHECK-IN STATUS</p>
                        </div>
                        <button
                            class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                            onClick={() => navigate("/admin")}
                        >
                            <Icon icon="ph:arrow-left-bold" class="group-hover:-translate-x-1 transition-transform" />
                            Back to Dashboard
                        </button>
                    </div>

                    {/* Stats Row */}
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                        <div class="glass-panel p-6 rounded-xl border border-white/10 bg-black/20">
                            <div class="text-secondary-300 text-sm font-mono mb-1">TOTAL ATTENDEES</div>
                            <div class="text-3xl font-bold text-white">{stats().total}</div>
                        </div>
                        <div class="glass-panel p-6 rounded-xl border border-white/10 bg-black/20">
                            <div class="text-secondary-300 text-sm font-mono mb-1">CHECKED IN</div>
                            <div class="text-3xl font-bold text-accent-400">{stats().checkedIn}</div>
                        </div>
                        <div class="glass-panel p-6 rounded-xl border border-white/10 bg-black/20">
                            <div class="text-secondary-300 text-sm font-mono mb-1">EST. REVENUE</div>
                            <div class="text-3xl font-bold text-primary-400">€{stats().revenue.toFixed(2)}</div>
                        </div>
                    </div>

                    <div class="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                        {/* Toolbar */}
                        <div class="p-4 border-b border-white/10 flex flex-col sm:flex-row justify-between items-center gap-4 bg-white/5">
                            <div class="relative w-full sm:w-96">
                                <Icon icon="ph:magnifying-glass" class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search by name, email, or ticket type..."
                                    class="input input-sm w-full pl-10 bg-black/20 border-white/10 focus:border-accent-500 text-white placeholder:text-gray-500"
                                    value={searchTerm()}
                                    onInput={(e) => setSearchTerm(e.currentTarget.value)}
                                />
                            </div>
                            <div class="text-xs text-secondary-300 font-mono">
                                * Showing first page only
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="table table-lg w-full">
                                <thead>
                                    <tr class="text-white border-b border-white/10 bg-white/5">
                                        <th class="font-mono text-secondary-300">ATTENDEE</th>
                                        <th class="font-bold text-gray-300">TICKET TYPE</th>
                                        <th class="text-center font-bold text-gray-300">PRICE</th>
                                        <th class="text-center font-bold text-gray-300">STATUS</th>
                                        <th class="text-right font-bold text-gray-300">ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <Show when={attendees.loading}>
                                        <tr>
                                            <td colspan="5" class="text-center py-10">
                                                <span class="loading loading-bars loading-lg text-accent-500"></span>
                                            </td>
                                        </tr>
                                    </Show>
                                    <Show when={!attendees.loading && filteredAttendees().length === 0}>
                                        <tr>
                                            <td colspan="5" class="text-center py-10 text-gray-500">
                                                No attendees found.
                                            </td>
                                        </tr>
                                    </Show>
                                    <For each={filteredAttendees()}>
                                        {(attendee) => (
                                            <tr class="hover:bg-white/5 border-b border-white/5 transition-colors group">
                                                <td>
                                                    <div class="flex items-center gap-3">
                                                        <div class="avatar">
                                                            <div class="w-10 rounded-full ring-1 ring-white/10">
                                                                <img
                                                                    src={getGravatarUrl(attendee.email)}
                                                                    alt={attendee.first_name || "Attendee"}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div class="font-bold text-white">{attendee.first_name} {attendee.last_name}</div>
                                                            <div class="text-xs opacity-50 font-mono text-accent-300">{attendee.email}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div class="badge badge-outline text-xs border-white/20 text-gray-300">
                                                        {attendee.ticket?.title || "Unknown Ticket"}
                                                    </div>
                                                </td>
                                                <td class="text-center font-mono">
                                                    {attendee.ticket?.price > 0
                                                        ? `${attendee.ticket.currency} ${attendee.ticket.price}`
                                                        : <span class="text-success text-xs">FREE</span>
                                                    }
                                                </td>
                                                <td class="text-center">
                                                    <Show when={attendee.checked_in_at} fallback={
                                                        <span class="badge badge-ghost badge-sm text-gray-500">Not Checked In</span>
                                                    }>
                                                        <div class="tooltip" data-tip={`at ${new Date(attendee.checked_in_at!).toLocaleTimeString()}`}>
                                                            <span class="badge badge-success badge-sm gap-1 pl-1 pr-2">
                                                                <Icon icon="ph:check-bold" /> Checked In
                                                            </span>
                                                        </div>
                                                    </Show>
                                                </td>
                                                <td class="text-right">
                                                    <a
                                                        href={attendee.public_url || "#"}
                                                        target="_blank"
                                                        class={`btn btn-ghost btn-xs text-gray-400 hover:text-white ${!attendee.public_url ? 'btn-disabled opacity-20' : ''}`}
                                                        title="View Public Ticket"
                                                    >
                                                        <Icon icon="ph:qr-code" />
                                                    </a>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                        <div class="p-2 border-t border-white/10 bg-white/5 text-center text-xs text-gray-500">
                            Synced from hi.events • {stats().total} records loaded
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
