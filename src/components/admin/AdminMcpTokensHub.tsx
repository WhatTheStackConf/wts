import { Icon } from "@iconify-icon/solid";
import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import {
  AdminDataPanel,
  AdminFilterBar,
  AdminFilterGroup,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFormPanelClass,
  adminInputClass,
  adminSelectClass,
  adminTextareaClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateMcpToken,
  adminFetchMcpActivity,
  adminFetchMcpTokens,
  adminRevokeMcpToken,
  type McpTokenSnapshot,
} from "~/lib/mcp-actions";
import type { McpActivityItem, McpTokenStatus } from "~/lib/mcp-token-administration";
import type { McpScope } from "~/lib/mcp-auth";
import { maximumNewMcpTokenExpiryDate } from "~/lib/mcp-token-policy";

const DEFAULT_SCOPES: McpScope[] = ["programme:read", "cfp:read"];
const CREATE_OPERATION_KEY = "wts:admin:mcp:create-operation";

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusPresentation(status: McpTokenStatus) {
  if (status === "revoked") return { label: "Revoked", class: "badge-error" };
  if (status === "expired") return { label: "Expired", class: "badge-warning" };
  if (status === "owner_disabled") return { label: "Owner disabled", class: "badge-neutral" };
  return { label: "Active", class: "badge-success" };
}

function actionStatusClass(status: McpActivityItem["status"]) {
  if (status === "applied") return "badge-success";
  if (status === "failed") return "badge-error";
  return "badge-warning";
}

function operationId(storageKey: string): string {
  if (typeof window === "undefined") throw new Error("MCP token operations require a browser.");
  const current = window.sessionStorage.getItem(storageKey);
  if (current) return current;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, created);
  return created;
}

function clearOperationId(storageKey: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(storageKey);
}

export default function AdminMcpTokensHub() {
  const { toast, showToast } = useAdminToast();
  const [error, setError] = createSignal<string | null>(null);
  const [name, setName] = createSignal("Program assistant");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [maximumExpiryDate, setMaximumExpiryDate] = createSignal("");
  const [scopes, setScopes] = createSignal<McpScope[]>(DEFAULT_SCOPES);
  const [saving, setSaving] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [createdToken, setCreatedToken] = createSignal<string | null>(null);
  const [mcpUrl, setMcpUrl] = createSignal("/api/mcp");
  const [revokeTargetId, setRevokeTargetId] = createSignal<string | null>(null);
  const [revokeReason, setRevokeReason] = createSignal("");
  const [tokenFilter, setTokenFilter] = createSignal("");
  const [ownerFilter, setOwnerFilter] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("");
  const [operationFilter, setOperationFilter] = createSignal("");
  const [targetFilter, setTargetFilter] = createSignal("");

  onMount(() => {
    const maximum = maximumNewMcpTokenExpiryDate();
    setExpiresAt(maximum);
    setMaximumExpiryDate(maximum);
    setMcpUrl(`${window.location.origin}/api/mcp`);
  });

  const [tokens, { refetch: refetchTokens }] = createResource(async () => {
    const result = await adminFetchMcpTokens();
    if (!result.success) {
      setError(result.error || "Could not load MCP tokens.");
      return [] as McpTokenSnapshot[];
    }
    setError(null);
    return result.data;
  });

  const [activity, { refetch: refetchActivity }] = createResource(async () => {
    const result = await adminFetchMcpActivity();
    if (!result.success) {
      setError(result.error || "Could not load MCP activity.");
      return [] as McpActivityItem[];
    }
    return result.data;
  });

  const activeCount = () => (tokens() || []).filter((token) => token.status === "active").length;
  const filteredActivity = createMemo(() => (activity() || []).filter((item) => {
    const target = `${item.targetCollection}:${item.targetId || ""}`;
    return (!tokenFilter() || item.token?.id === tokenFilter()) &&
      (!ownerFilter() || item.owner.id === ownerFilter()) &&
      (!statusFilter() || item.status === statusFilter()) &&
      (!operationFilter() || item.operationKind === operationFilter()) &&
      (!targetFilter() || target === targetFilter());
  }));
  const activityOwners = createMemo(() => {
    const owners = new Map((activity() || []).map((item) => [item.owner.id, item.owner]));
    return [...owners.values()].sort((left, right) => left.name.localeCompare(right.name));
  });
  const activityOperations = createMemo(() =>
    [...new Set((activity() || []).map((item) => item.operationKind))].sort(),
  );
  const activityTargets = createMemo(() => {
    const targets = new Map((activity() || []).map((item) => [
      `${item.targetCollection}:${item.targetId || ""}`,
      `${item.targetCollection}${item.targetId ? ` / ${item.targetId}` : " / pending target"}`,
    ]));
    return [...targets.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  });

  const resetCreateOperation = () => clearOperationId(CREATE_OPERATION_KEY);
  const toggleScope = (scope: McpScope, checked: boolean) => {
    resetCreateOperation();
    const current = scopes();
    if (checked && !current.includes(scope)) setScopes([...current, scope]);
    if (!checked) setScopes(current.filter((item) => item !== scope));
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setSaving(true);
    setCreatedToken(null);
    const result = await adminCreateMcpToken(operationId(CREATE_OPERATION_KEY), {
      name: name(),
      scopes: scopes(),
      expires_at: expiresAt(),
    });
    if (!result.success) {
      showToast("error", result.error || "Could not create MCP token.");
      if (result.code === "operation_mismatch") resetCreateOperation();
    } else {
      clearOperationId(CREATE_OPERATION_KEY);
      if (result.data.credentialAvailable && result.data.credential) {
        setCreatedToken(result.data.credential);
        showToast("success", "MCP token created. Copy it now; it will not be shown again.");
      } else {
        showToast("success", "The token already exists, but its one-time credential cannot be shown again.");
      }
      setName("Program assistant");
      const maximum = maximumNewMcpTokenExpiryDate();
      setExpiresAt(maximum);
      setMaximumExpiryDate(maximum);
      setScopes(DEFAULT_SCOPES);
      await Promise.all([refetchTokens(), refetchActivity()]);
    }
    setSaving(false);
  };

  const revoke = async (event: Event, token: McpTokenSnapshot) => {
    event.preventDefault();
    if (token.status !== "active") return;
    const storageKey = `wts:admin:mcp:revoke-operation:${token.id}`;
    setBusyId(token.id);
    const result = await adminRevokeMcpToken(
      operationId(storageKey),
      token.id,
      revokeReason(),
    );
    if (!result.success) {
      showToast("error", result.error || "Could not revoke MCP token.");
      if (result.code === "operation_mismatch") clearOperationId(storageKey);
    } else {
      clearOperationId(storageKey);
      setRevokeTargetId(null);
      setRevokeReason("");
      showToast("success", `"${token.name}" revoked.`);
      await Promise.all([refetchTokens(), refetchActivity()]);
    }
    setBusyId(null);
  };

  const copyToken = async () => {
    const token = createdToken();
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      showToast("success", "Token copied to clipboard.");
    } catch {
      showToast("error", "Could not copy token. Select the token text and copy it manually.");
    }
  };

  return (
    <AdminPageShell
      layoutTitle="Admin: MCP"
      layoutDescription="Govern MCP access tokens and activity"
      title="MCP Access"
      subtitle="TEAM TOKEN GOVERNANCE"
      hint="Every current admin can inspect safe credential metadata, review activity, and revoke an active token. Token material remains one-time and unrecoverable."
      count={activeCount()}
      countLoading={tokens.loading}
      accent="secondary"
      toast={toast()}
    >
      <Show when={error()}>
        <div class="alert alert-error mb-6 font-mono text-sm" role="alert">
          <span>{error()}</span>
        </div>
      </Show>

      <div class="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
        <form onSubmit={submit} class={`${adminFormPanelClass} xl:col-span-2`}>
          <AdminFormSection
            title="Create token"
            description="Tokens default to 90 days and are shown once. Store only the generated credential in your MCP client."
          >
            <div class="space-y-5">
              <AdminFormField
                id="mcp-token-name"
                label="Token name"
                required
                hint="Use a name that identifies the client or workflow."
                error="Add a token name before creating it."
              >
                <input
                  id="mcp-token-name"
                  name="name"
                  class={adminInputClass()}
                  required
                  maxlength="120"
                  autocomplete="off"
                  value={name()}
                  aria-describedby="mcp-token-name-hint"
                  aria-errormessage="mcp-token-name-error"
                  onInvalid={markAdminControlInvalid}
                  onBlur={syncAdminControlValidity}
                  onInput={(event) => {
                    clearAdminControlValidity(event);
                    resetCreateOperation();
                    setName(event.currentTarget.value);
                  }}
                />
              </AdminFormField>

              <AdminFormField
                id="mcp-token-expiry"
                label="Expires on"
                required
                hint="New tokens expire within 90 days to limit leaked-token impact."
                error="Choose a future date within 90 days."
              >
                <input
                  id="mcp-token-expiry"
                  name="expires_at"
                  type="date"
                  class={adminInputClass("font-mono")}
                  required
                  max={maximumExpiryDate() || undefined}
                  value={expiresAt()}
                  aria-describedby="mcp-token-expiry-hint"
                  aria-errormessage="mcp-token-expiry-error"
                  onInvalid={markAdminControlInvalid}
                  onBlur={syncAdminControlValidity}
                  onInput={(event) => {
                    clearAdminControlValidity(event);
                    resetCreateOperation();
                    setExpiresAt(event.currentTarget.value);
                  }}
                />
              </AdminFormField>

              <fieldset class="border border-white/10 rounded-xl p-4">
                <legend class="px-2 text-xs font-mono uppercase tracking-[0.14em] text-base-content/80">
                  Scopes
                </legend>
                <label class="flex items-start gap-3 cursor-pointer min-h-12 py-2" for="mcp-scope-programme-read">
                  <input
                    id="mcp-scope-programme-read"
                    name="scope_programme_read"
                    type="checkbox"
                    class="checkbox checkbox-secondary mt-1"
                    checked={scopes().includes("programme:read")}
                    onChange={(event) => toggleScope("programme:read", event.currentTarget.checked)}
                  />
                  <span>
                    <span class="block text-sm font-bold text-white font-mono">programme:read</span>
                    <span class="block text-xs text-base-content/45 mt-1 leading-relaxed">
                      Read draft and Published Sessions, Speakers, and schedule context.
                    </span>
                  </span>
                </label>
                <label class="flex items-start gap-3 cursor-pointer min-h-12 py-2" for="mcp-scope-cfp-read">
                  <input
                    id="mcp-scope-cfp-read"
                    name="scope_cfp_read"
                    type="checkbox"
                    class="checkbox checkbox-secondary mt-1"
                    checked={scopes().includes("cfp:read")}
                    onChange={(event) => toggleScope("cfp:read", event.currentTarget.checked)}
                  />
                  <span>
                    <span class="block text-sm font-bold text-white font-mono">cfp:read</span>
                    <span class="block text-xs text-base-content/45 mt-1 leading-relaxed">
                      Read CFP Submissions, applicant context, and aggregate review summaries.
                    </span>
                  </span>
                </label>
              </fieldset>

              <button type="submit" class="btn btn-secondary font-mono w-full gap-2 min-h-12" disabled={saving()}>
                <Icon icon="ph:key-bold" aria-hidden="true" />
                <Show when={saving()} fallback="Create MCP Token">Creating...</Show>
              </button>
            </div>
          </AdminFormSection>

          <Show when={createdToken()}>
            {(token) => (
              <section class="mt-6 border border-success/30 bg-success/10 rounded-2xl p-4" aria-live="polite">
                <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 class="text-sm font-bold text-success uppercase tracking-[0.08em]">Copy this token now</h3>
                    <p class="text-xs text-base-content/60 font-mono mt-1">It will not be shown again after you leave this page.</p>
                  </div>
                  <button type="button" class="btn btn-sm btn-success font-mono min-h-12" onClick={copyToken}>Copy</button>
                </div>
                <pre tabindex="0" class="text-xs whitespace-pre-wrap break-all rounded-xl bg-black/60 p-3 text-success-content font-mono border border-white/10">
                  <code>{token()}</code>
                </pre>
              </section>
            )}
          </Show>
        </form>

        <div class="xl:col-span-3 space-y-6">
          <AdminDataPanel>
            <div class="p-5 sm:p-6 border-b border-white/10">
              <h2 class="text-lg font-bold text-white">MCP client configuration</h2>
              <p class="text-xs text-base-content/45 font-mono mt-1 max-w-3xl">
                Point your MCP client at this endpoint and send the generated token as a bearer token.
              </p>
              <dl class="mt-4 grid gap-3 text-sm">
                <div>
                  <dt class="text-xs font-mono uppercase tracking-[0.14em] text-base-content/50">Endpoint</dt>
                  <dd class="mt-1 rounded-xl bg-black/50 border border-white/10 p-3 font-mono text-secondary-200 break-all">{mcpUrl()}</dd>
                </div>
                <div>
                  <dt class="text-xs font-mono uppercase tracking-[0.14em] text-base-content/50">Header</dt>
                  <dd class="mt-1 rounded-xl bg-black/50 border border-white/10 p-3 font-mono text-secondary-200 break-all">Authorization: Bearer wts_mcp_...</dd>
                </div>
              </dl>
            </div>
          </AdminDataPanel>

          <AdminDataPanel>
            <div class="p-5 sm:p-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 class="text-lg font-bold text-white">Team tokens</h2>
                <p class="text-xs text-base-content/45 font-mono mt-1">
                  Ownership stays recorded. Any current admin can revoke an active credential with a reason.
                </p>
              </div>
              <button type="button" class="btn btn-sm btn-ghost font-mono min-h-12" onClick={() => refetchTokens()}>Refresh</button>
            </div>

            <Show
              when={(tokens() || []).length > 0}
              fallback={<div class="p-8 text-center text-base-content/50 font-mono text-sm">No MCP tokens yet.</div>}
            >
              <div class="divide-y divide-white/10">
                <For each={tokens() || []}>
                  {(token) => {
                    const status = statusPresentation(token.status);
                    const storageKey = `wts:admin:mcp:revoke-operation:${token.id}`;
                    return (
                      <article class="p-5 sm:p-6">
                        <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2 mb-2">
                              <h3 class="text-base font-bold text-white break-words">{token.name}</h3>
                              <span class={`badge font-mono ${status.class}`}>{status.label}</span>
                            </div>
                            <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-base-content/55">
                              <span>Owner: {token.owner.name}</span>
                              <span>Prefix: {token.tokenPrefix}</span>
                              <span>Scopes: {token.scopes.join(", ") || "None"}</span>
                              <span>Expires: {formatDateTime(token.expiresAt)}</span>
                              <span>Last authenticated: {formatDateTime(token.lastUsedAt)}</span>
                              <span>Created: {formatDateTime(token.createdAt)}</span>
                              <Show when={token.revokedAt}>
                                <span>Revoked: {formatDateTime(token.revokedAt)}</span>
                              </Show>
                              <Show when={token.revokedBy}>
                                {(revoker) => <span>Revoked by: {revoker().name}</span>}
                              </Show>
                            </div>
                            <Show when={token.revocationReason}>
                              <p class="mt-3 text-xs text-base-content/65"><span class="font-mono uppercase">Reason:</span> {token.revocationReason}</p>
                            </Show>
                          </div>
                          <Show when={token.status === "active"}>
                            <button
                              type="button"
                              class="btn btn-sm btn-outline btn-error font-mono min-h-12"
                              aria-expanded={revokeTargetId() === token.id}
                              aria-controls={`revoke-token-${token.id}`}
                              onClick={() => {
                                if (revokeTargetId() === token.id) {
                                  setRevokeTargetId(null);
                                  setRevokeReason("");
                                  clearOperationId(storageKey);
                                } else {
                                  setRevokeTargetId(token.id);
                                  setRevokeReason("");
                                }
                              }}
                            >
                              Revoke
                            </button>
                          </Show>
                        </div>

                        <Show when={revokeTargetId() === token.id}>
                          <form id={`revoke-token-${token.id}`} class="mt-5 rounded-xl border border-error/25 bg-error/5 p-4" onSubmit={(event) => revoke(event, token)}>
                            <label class="block text-sm font-bold text-white" for={`revoke-reason-${token.id}`}>
                              Revocation reason <span class="text-error" aria-hidden="true">*</span>
                            </label>
                            <p id={`revoke-reason-${token.id}-hint`} class="mt-1 text-xs font-mono text-base-content/55">
                              Required for the immutable Admin Action. Maximum 500 characters; do not paste credentials.
                            </p>
                            <textarea
                              id={`revoke-reason-${token.id}`}
                              name="revocation_reason"
                              class={`${adminTextareaClass("mt-3 min-h-24 resize-y")} text-base`}
                              required
                              maxlength="500"
                              aria-describedby={`revoke-reason-${token.id}-hint`}
                              value={revokeReason()}
                              onInput={(event) => {
                                clearOperationId(storageKey);
                                setRevokeReason(event.currentTarget.value);
                              }}
                            />
                            <div class="mt-3 flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                class="btn btn-sm btn-ghost font-mono min-h-12"
                                onClick={() => {
                                  setRevokeTargetId(null);
                                  setRevokeReason("");
                                  clearOperationId(storageKey);
                                }}
                              >
                                Cancel
                              </button>
                              <button type="submit" class="btn btn-sm btn-error font-mono min-h-12" disabled={busyId() === token.id}>
                                <Show when={busyId() === token.id} fallback="Confirm revocation">Revoking...</Show>
                              </button>
                            </div>
                          </form>
                        </Show>
                      </article>
                    );
                  }}
                </For>
              </div>
            </Show>
          </AdminDataPanel>
        </div>
      </div>

      <AdminDataPanel>
        <div class="p-5 sm:p-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 class="text-lg font-bold text-white">Recent MCP activity</h2>
            <p class="text-xs text-base-content/45 font-mono mt-1">
              Applied, pending, and failed Admin Actions for MCP credentials and MCP-initiated mutations.
            </p>
          </div>
          <button type="button" class="btn btn-sm btn-ghost font-mono min-h-12" onClick={() => refetchActivity()}>Refresh</button>
        </div>
        <div class="p-5 sm:p-6">
          <AdminFilterBar
            showCount
            filteredCount={filteredActivity().length}
            totalCount={(activity() || []).length}
          >
            <AdminFilterGroup label="Token:">
              <select class={adminSelectClass("select-sm w-full sm:w-auto min-h-12")} value={tokenFilter()} onChange={(event) => setTokenFilter(event.currentTarget.value)}>
                <option value="">All tokens</option>
                <For each={tokens() || []}>{(token) => <option value={token.id}>{token.name} / {token.tokenPrefix}</option>}</For>
              </select>
            </AdminFilterGroup>
            <AdminFilterGroup label="Owner:">
              <select class={adminSelectClass("select-sm w-full sm:w-auto min-h-12")} value={ownerFilter()} onChange={(event) => setOwnerFilter(event.currentTarget.value)}>
                <option value="">All owners</option>
                <For each={activityOwners()}>{(owner) => <option value={owner.id}>{owner.name}</option>}</For>
              </select>
            </AdminFilterGroup>
            <AdminFilterGroup label="Status:">
              <select class={adminSelectClass("select-sm w-full sm:w-auto min-h-12")} value={statusFilter()} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="applied">Applied</option>
                <option value="failed">Failed</option>
              </select>
            </AdminFilterGroup>
            <AdminFilterGroup label="Operation:">
              <select class={adminSelectClass("select-sm w-full sm:w-auto min-h-12")} value={operationFilter()} onChange={(event) => setOperationFilter(event.currentTarget.value)}>
                <option value="">All operations</option>
                <For each={activityOperations()}>{(operation) => <option value={operation}>{operation}</option>}</For>
              </select>
            </AdminFilterGroup>
            <AdminFilterGroup label="Target:">
              <select class={adminSelectClass("select-sm w-full sm:w-auto min-h-12")} value={targetFilter()} onChange={(event) => setTargetFilter(event.currentTarget.value)}>
                <option value="">All targets</option>
                <For each={activityTargets()}>{([value, label]) => <option value={value}>{label}</option>}</For>
              </select>
            </AdminFilterGroup>
          </AdminFilterBar>

          <Show
            when={filteredActivity().length > 0}
            fallback={<div class="py-8 text-center text-base-content/50 font-mono text-sm">No MCP activity matches these filters.</div>}
          >
            <div class="grid gap-3">
              <For each={filteredActivity()}>
                {(item) => (
                  <article class="rounded-xl border border-white/10 bg-black/25 p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class={`badge font-mono ${actionStatusClass(item.status)}`}>{item.status}</span>
                          <h3 class="font-mono text-sm font-bold text-white break-all">{item.operationKind}</h3>
                        </div>
                        <p class="mt-2 text-xs text-base-content/60 font-mono break-all">
                          Target: {item.targetCollection} / {item.targetId || "pending"}
                        </p>
                      </div>
                      <time class="text-xs font-mono text-base-content/45" datetime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
                    </div>
                    <dl class="mt-3 grid gap-1 text-xs font-mono text-base-content/55 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt class="inline text-base-content/40">Token: </dt>
                        <dd class="inline">
                          <Show when={item.token} fallback="Pending target">
                            {(token) => `${token().name} / ${token().tokenPrefix}`}
                          </Show>
                        </dd>
                      </div>
                      <div><dt class="inline text-base-content/40">Owner: </dt><dd class="inline">{item.owner.name}</dd></div>
                      <div><dt class="inline text-base-content/40">Actor: </dt><dd class="inline">{item.actor.name}</dd></div>
                      <div><dt class="inline text-base-content/40">Attempt: </dt><dd class="inline">{item.attemptCount}</dd></div>
                    </dl>
                    <Show when={item.revocationReason}>{(reason) => <p class="mt-3 text-sm text-base-content/70">Reason: {reason()}</p>}</Show>
                    <Show when={item.failure}>
                      {(failure) => (
                        <p class="mt-3 rounded-lg border border-error/20 bg-error/10 p-3 text-xs text-error-content" role="status">
                          {failure().code}: {failure().message}
                        </p>
                      )}
                    </Show>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </div>
      </AdminDataPanel>
    </AdminPageShell>
  );
}
