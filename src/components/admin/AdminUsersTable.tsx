import { createSignal, createResource, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { adminFetchAllUsers, adminUpdateUser } from "~/lib/admin-actions";
import { UserRecord } from "~/lib/pocketbase-types";
import { getGravatarUrl } from "~/lib/gravatar";

const ROLES = ["user", "reviewer", "admin"];

export default function AdminUsersTable() {
    const auth = useAuth();
    const navigate = useNavigate();

    // Fetch users using server action
    const [users, { refetch }] = createResource(async () => {
        const res = await adminFetchAllUsers();
        if (res.success) {
            return res.data as UserRecord[];
        }
        return [];
    });

    const [updating, setUpdating] = createSignal<string | null>(null);

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) return;

        setUpdating(userId);
        try {
            const res = await adminUpdateUser(userId, { role: newRole });
            if (res.success) {
                await refetch();
            } else {
                alert("Failed to update role: " + res.error);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setUpdating(null);
        }
    };

    const handleToggleVerification = async (userId: string, currentStatus: boolean) => {
        setUpdating(userId);
        try {
            const res = await adminUpdateUser(userId, { verified: !currentStatus });
            if (res.success) {
                await refetch();
            } else {
                alert("Failed to update verification: " + res.error);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setUpdating(null);
        }
    };

    return (
        <Layout title="User Management" description="Manage system users">
            <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
                {/* Background Decorations */}
                <div class="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>
                <div class="absolute bottom-0 left-0 w-[500px] h-[500px] bg-secondary-900/10 rounded-full blur-[120px] -z-10 pointer-events-none"></div>

                <div class="container mx-auto px-4 max-w-7xl">
                    <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
                        <div>
                            <h1 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-white uppercase drop-shadow-sm mb-2">User Management</h1>
                            <p class="text-secondary-300 font-mono text-sm">SYSTEM ACCESS & STATS</p>
                        </div>
                        <button
                            class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                            onClick={() => navigate("/admin")}
                        >
                            <Icon icon="ph:arrow-left-bold" class="group-hover:-translate-x-1 transition-transform" />
                            Back to Dashboard
                        </button>
                    </div>

                    <div class="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
                        {/* Mobile Card View */}
                        <div class="md:hidden space-y-4 p-4">
                            <For each={users()}>
                                {(user) => (
                                    <div class="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
                                        <div class="flex items-start justify-between gap-3">
                                            <div class="flex items-center gap-3">
                                                <div class="avatar">
                                                    <div class="w-10 rounded-full ring-1 ring-white/10">
                                                        <img
                                                            src={getGravatarUrl(user.email)}
                                                            alt={user.name || "User"}
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div class="font-bold text-white">{user.name || "Unknown"}</div>
                                                    <div class="text-xs opacity-50 font-mono">{user.email}</div>
                                                </div>
                                            </div>

                                            <div class="dropdown dropdown-end">
                                                <div tabindex="0" role="button" class={`badge badge-sm font-bold cursor-pointer border-0 ${user.role === 'admin' ? 'bg-error-500/20 text-error-400' :
                                                    user.role === 'reviewer' ? 'bg-secondary-500/20 text-secondary-300' :
                                                        'bg-white/10 text-gray-400'
                                                    }`}>
                                                    {user.role.toUpperCase()}
                                                </div>
                                                <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-900 rounded-box w-52 border border-white/10 text-white">
                                                    <For each={ROLES}>
                                                        {(role) => (
                                                            <li>
                                                                <a
                                                                    class={user.role === role ? "active" : ""}
                                                                    onClick={() => handleRoleChange(user.id, role)}
                                                                >
                                                                    {role.toUpperCase()}
                                                                </a>
                                                            </li>
                                                        )}
                                                    </For>
                                                </ul>
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-between pt-3 border-t border-white/5">
                                            <div class="text-xs opacity-50 font-mono">
                                                Joined {new Date(user.created).toLocaleDateString()}
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <button
                                                    class={`btn btn-sm btn-circle ${user.verified ? 'btn-success text-white' : 'btn-ghost text-gray-500'}`}
                                                    onClick={() => handleToggleVerification(user.id, !!user.verified)}
                                                    disabled={updating() === user.id}
                                                >
                                                    <Icon icon={user.verified ? "ph:check-bold" : "ph:x-bold"} />
                                                </button>
                                                <button class="btn btn-ghost btn-xs text-gray-400 hover:text-white" disabled>
                                                    Details
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>

                        {/* Desktop Table View */}
                        <div class="hidden md:block overflow-x-auto">
                            <table class="table table-lg w-full">
                                <thead>
                                    <tr class="text-white border-b border-white/10 bg-white/5">
                                        <th class="font-mono text-secondary-300">USER</th>
                                        <th class="text-center font-bold text-gray-300">ROLE</th>
                                        <th class="text-center font-bold text-gray-300">VERIFIED</th>
                                        <th class="text-center font-bold text-gray-300">CREATED</th>
                                        <th class="text-center font-bold text-gray-300">ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <Show when={users.loading}>
                                        <tr>
                                            <td colspan="5" class="text-center py-10">
                                                <span class="loading loading-bars loading-lg text-primary-500"></span>
                                            </td>
                                        </tr>
                                    </Show>
                                    <For each={users()}>
                                        {(user) => (
                                            <tr class="hover:bg-white/5 border-b border-white/5 transition-colors group">
                                                <td>
                                                    <div class="flex items-center gap-3">
                                                        <div class="avatar">
                                                            <div class="w-10 rounded-full ring-1 ring-white/10">
                                                                <img
                                                                    src={getGravatarUrl(user.email)}
                                                                    alt={user.name || "User"}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div class="font-bold text-white">{user.name || "Unknown"}</div>
                                                            <div class="text-xs opacity-50 font-mono">{user.email}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td class="text-center">
                                                    <div class="dropdown dropdown-end">
                                                        <div tabindex="0" role="button" class={`badge badge-lg font-bold cursor-pointer border-0 ${user.role === 'admin' ? 'bg-error-500/20 text-error-400' :
                                                            user.role === 'reviewer' ? 'bg-secondary-500/20 text-secondary-300' :
                                                                'bg-white/10 text-gray-400'
                                                            }`}>
                                                            {user.role.toUpperCase()}
                                                        </div>
                                                        <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-900 rounded-box w-52 border border-white/10 text-white">
                                                            <For each={ROLES}>
                                                                {(role) => (
                                                                    <li>
                                                                        <a
                                                                            class={user.role === role ? "active" : ""}
                                                                            onClick={() => handleRoleChange(user.id, role)}
                                                                        >
                                                                            {role.toUpperCase()}
                                                                        </a>
                                                                    </li>
                                                                )}
                                                            </For>
                                                        </ul>
                                                    </div>
                                                </td>
                                                <td class="text-center">
                                                    <button
                                                        class={`btn btn-xs btn-circle ${user.verified ? 'btn-success text-white' : 'btn-ghost text-gray-500'}`}
                                                        onClick={() => handleToggleVerification(user.id, !!user.verified)}
                                                        disabled={updating() === user.id}
                                                    >
                                                        <Icon icon={user.verified ? "ph:check-bold" : "ph:x-bold"} />
                                                    </button>
                                                </td>
                                                <td class="text-center font-mono text-xs opacity-50">
                                                    {new Date(user.created).toLocaleDateString()}
                                                </td>
                                                <td class="text-center">
                                                    <button class="btn btn-ghost btn-xs text-gray-400 hover:text-white" disabled>
                                                        Details
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </For>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
            {/* Added closing div back */}
        </Layout>
    );
}
