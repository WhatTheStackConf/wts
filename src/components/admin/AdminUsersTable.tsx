import { createSignal, createResource, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";
import { useAuth } from "~/lib/auth-context";
import { adminFetchAllUsers, adminUpdateUser, adminDeleteUser } from "~/lib/admin-actions";
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
            return res.data as (UserRecord & { isApplicant?: boolean })[];
        }
        return [];
    });

    const [selectedUser, setSelectedUser] = createSignal<(UserRecord & { isApplicant?: boolean }) | null>(null);
    const [deleteId, setDeleteId] = createSignal<{ id: string, name: string } | null>(null);

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

    const handleDeleteClick = (userId: string, userName: string) => {
        setDeleteId({ id: userId, name: userName });
    };

    const handleConfirmDelete = async () => {
        const target = deleteId();
        if (!target) return;

        setUpdating(target.id);
        try {
            const res = await adminDeleteUser(target.id);
            if (res.success) {
                await refetch();
                setDeleteId(null);
            } else {
                alert("Failed to delete user: " + res.error);
            }
        } catch (e) {
            console.error(e);
            alert("An unknown error occurred");
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
                                                    {(user.role || 'user').toUpperCase()}
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
                                                <button
                                                    class="btn btn-sm btn-circle bg-error-500/20 text-error-400 hover:bg-error-500 hover:text-white border-none"
                                                    onClick={() => handleDeleteClick(user.id, user.name)}
                                                    disabled={updating() === user.id}
                                                >
                                                    <Icon icon="ph:trash-bold" />
                                                </button>
                                                <button
                                                    class="btn btn-ghost btn-xs text-gray-400 hover:text-white"
                                                    onClick={() => setSelectedUser(user)}
                                                >
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
                                                            <div class="font-bold text-white flex items-center gap-2">
                                                                {user.name || "Unknown"}
                                                                <Show when={user.isApplicant}>
                                                                    <div class="tooltip" data-tip="Applicant Profile">
                                                                        <Icon icon="ph:microphone-stage-bold" class="text-primary-400" />
                                                                    </div>
                                                                </Show>
                                                            </div>
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
                                                            {(user.role || 'user').toUpperCase()}
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
                                                        title={user.verified ? "Verified" : "Unverified"}
                                                    >
                                                        <Icon icon={user.verified ? "ph:check-bold" : "ph:x-bold"} />
                                                    </button>
                                                </td>
                                                <td class="text-center font-mono text-xs opacity-50">
                                                    {new Date(user.created).toISOString().split('T')[0]}
                                                </td>
                                                <td class="text-center">
                                                    <div class="flex items-center justify-center gap-2">
                                                        <button
                                                            class="btn btn-ghost btn-xs text-gray-400 hover:text-white"
                                                            onClick={() => setSelectedUser(user)}
                                                        >
                                                            Details
                                                        </button>
                                                        <button
                                                            class="btn btn-xs btn-circle bg-error-500/20 text-error-400 hover:bg-error-500 hover:text-white border-none transition-colors"
                                                            onClick={() => handleDeleteClick(user.id, user.name)}
                                                            disabled={updating() === user.id}
                                                            title="Delete User"
                                                        >
                                                            <Icon icon="ph:trash-bold" />
                                                        </button>
                                                    </div>
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
            {/* User Details Modal */}
            <Show when={selectedUser()}>
                <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedUser(null)}></div>
                    <div class="bg-base-900 border border-white/10 p-0 rounded-2xl relative z-10 max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div class="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
                            <h3 class="text-xl font-bold text-white">User Details</h3>
                            <button onClick={() => setSelectedUser(null)} class="btn btn-circle btn-ghost btn-sm">
                                <Icon icon="ph:x-bold" />
                            </button>
                        </div>
                        <div class="p-6 space-y-6">
                            <div class="flex items-center gap-4">
                                <div class="avatar">
                                    <div class="w-20 rounded-full ring-2 ring-white/10">
                                        <img
                                            src={getGravatarUrl(selectedUser()?.email || "")}
                                            alt={selectedUser()?.name || "User"}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <h4 class="text-lg font-bold text-white flex items-center gap-2">
                                        {selectedUser()?.name || "Unknown"}
                                        <Show when={selectedUser()?.isApplicant}>
                                            <span class="badge badge-primary badge-sm gap-1">
                                                <Icon icon="ph:microphone-stage-bold" />
                                                APPLICANT
                                            </span>
                                        </Show>
                                    </h4>
                                    <p class="text-secondary-300 font-mono text-sm">{selectedUser()?.email}</p>
                                    <p class="text-xs text-gray-500 font-mono mt-1">{selectedUser()?.id}</p>
                                </div>
                            </div>

                            <div class="grid grid-cols-2 gap-4">
                                <div class="bg-white/5 p-3 rounded-lg border border-white/5">
                                    <div class="text-xs text-gray-400 uppercase font-bold mb-1">Role</div>
                                    <div class="font-mono text-white">{(selectedUser()?.role || "user").toUpperCase()}</div>
                                </div>
                                <div class="bg-white/5 p-3 rounded-lg border border-white/5">
                                    <div class="text-xs text-gray-400 uppercase font-bold mb-1">Status</div>
                                    <div class={`font-mono font-bold ${selectedUser()?.verified ? 'text-success' : 'text-warning'}`}>
                                        {selectedUser()?.verified ? "VERIFIED" : "UNVERIFIED"}
                                    </div>
                                </div>
                                <div class="bg-white/5 p-3 rounded-lg border border-white/5">
                                    <div class="text-xs text-gray-400 uppercase font-bold mb-1">Joined</div>
                                    <div class="font-mono text-white">
                                        {selectedUser()?.created ? new Date(selectedUser()!.created).toISOString().split('T')[0] : 'N/A'}
                                    </div>
                                </div>
                                <div class="bg-white/5 p-3 rounded-lg border border-white/5">
                                    <div class="text-xs text-gray-400 uppercase font-bold mb-1">Last Updated</div>
                                    <div class="font-mono text-white">
                                        {selectedUser()?.updated ? new Date(selectedUser()!.updated).toISOString().split('T')[0] : 'N/A'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="p-4 bg-black/20 border-t border-white/5 flex justify-end">
                            <button class="btn btn-ghost" onClick={() => setSelectedUser(null)}>Close</button>
                        </div>
                    </div>
                </div>
            </Show>

            {/* Delete Confirmation Modal */}
            <Show when={deleteId()}>
                <div class="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div class="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => !updating() && setDeleteId(null)}></div>
                    <div class="relative bg-base-100 border border-white/10 rounded-2xl shadow-2xl p-6 max-w-sm w-full animate-scale-in">
                        <div class="flex items-center gap-3 mb-2 text-error">
                            <Icon icon="ph:warning-circle-bold" class="text-2xl" />
                            <h3 class="text-xl font-bold text-white">Delete User?</h3>
                        </div>
                        <p class="text-gray-400 mb-6 leading-relaxed">
                            Are you sure you want to PERMANENTLY delete <span class="text-white font-bold">{deleteId()?.name || "this user"}</span>? This action cannot be undone.
                        </p>
                        <div class="flex justify-end gap-3">
                            <button
                                class="btn btn-ghost hover:bg-white/5"
                                onClick={() => setDeleteId(null)}
                                disabled={!!updating()}
                            >
                                Cancel
                            </button>
                            <button
                                class="btn btn-error shadow-lg shadow-error/20"
                                onClick={handleConfirmDelete}
                                disabled={!!updating()}
                            >
                                {updating() === deleteId()?.id ? <span class="loading loading-spinner"></span> : "Delete Forever"}
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </Layout>
    );
}
