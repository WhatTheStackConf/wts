import { createResource, createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "@iconify-icon/solid";
import {
  AdminDataPanel,
  AdminFormField,
  AdminFormSection,
  AdminPageShell,
  adminFormPanelClass,
  adminInputClass,
  clearAdminControlValidity,
  markAdminControlInvalid,
  syncAdminControlValidity,
  useAdminToast,
} from "~/components/admin/AdminPageShell";
import {
  adminCreateMcpToken,
  adminFetchMcpTokens,
  adminRevokeMcpToken,
  type McpTokenSnapshot,
} from "~/lib/mcp-actions";
import type { McpScope } from "~/lib/mcp-auth";

const DEFAULT_SCOPES: McpScope[] = ["program:read"];

function defaultExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function tokenStatus(token: McpTokenSnapshot) {
  if (token.revoked_at) return { label: "Revoked", class: "badge-error" };
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) {
    return { label: "Expired", class: "badge-warning" };
  }
  return { label: "Active", class: "badge-success" };
}

export default function AdminMcpTokensHub() {
  const { toast, showToast } = useAdminToast();
  const [error, setError] = createSignal<string | null>(null);
  const [name, setName] = createSignal("Program assistant");
  const [expiresAt, setExpiresAt] = createSignal(defaultExpiryDate());
  const [scopes, setScopes] = createSignal<McpScope[]>(DEFAULT_SCOPES);
  const [saving, setSaving] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [createdToken, setCreatedToken] = createSignal<string | null>(null);
  const [mcpUrl, setMcpUrl] = createSignal("/api/mcp");

  onMount(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
  });

  const [tokens, { refetch }] = createResource(async () => {
    const res = await adminFetchMcpTokens();
    if (!res.success) {
      setError(res.error || "Could not load MCP tokens.");
      return [] as McpTokenSnapshot[];
    }
    setError(null);
    return res.data as McpTokenSnapshot[];
  });

  const activeCount = () =>
    (tokens() || []).filter((token) => tokenStatus(token).label === "Active").length;

  const toggleScope = (scope: McpScope, checked: boolean) => {
    const current = scopes();
    if (checked && !current.includes(scope)) setScopes([...current, scope]);
    if (!checked) setScopes(current.filter((item) => item !== scope));
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    setSaving(true);
    setCreatedToken(null);
    const res = await adminCreateMcpToken({
      name: name(),
      scopes: scopes(),
      expires_at: expiresAt(),
    });

    if (!res.success) {
      showToast("error", res.error || "Could not create MCP token.");
    } else {
      setCreatedToken(res.token || null);
      showToast("success", "MCP token created. Copy it now; it will not be shown again.");
      setName("Program assistant");
      setExpiresAt(defaultExpiryDate());
      setScopes(DEFAULT_SCOPES);
      await refetch();
    }
    setSaving(false);
  };

  const revoke = async (token: McpTokenSnapshot) => {
    if (token.revoked_at) return;
    setBusyId(token.id);
    const res = await adminRevokeMcpToken(token.id);
    if (!res.success) {
      showToast("error", res.error || "Could not revoke MCP token.");
    } else {
      showToast("success", `"${token.name}" revoked.`);
      await refetch();
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
      layoutDescription="Manage MCP access tokens"
      title="MCP Access"
      subtitle="LLM PROGRAMME ASSISTANT TOKENS"
      hint="Create scoped bearer tokens for remote MCP clients. Tokens can read admin programme context without exposing your browser session or OAuth credentials."
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
            description="Tokens default to 90 days and are shown once. Store only the generated token in your MCP client."
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
                  autocomplete="off"
                  value={name()}
                  aria-describedby="mcp-token-name-hint"
                  aria-errormessage="mcp-token-name-error"
                  onInvalid={markAdminControlInvalid}
                  onBlur={syncAdminControlValidity}
                  onInput={(event) => {
                    clearAdminControlValidity(event);
                    setName(event.currentTarget.value);
                  }}
                />
              </AdminFormField>

              <AdminFormField
                id="mcp-token-expiry"
                label="Expires on"
                required
                hint="A future expiry date limits leaked-token impact."
                error="Choose a future expiry date."
              >
                <input
                  id="mcp-token-expiry"
                  name="expires_at"
                  type="date"
                  class={adminInputClass("font-mono")}
                  required
                  value={expiresAt()}
                  aria-describedby="mcp-token-expiry-hint"
                  aria-errormessage="mcp-token-expiry-error"
                  onInvalid={markAdminControlInvalid}
                  onBlur={syncAdminControlValidity}
                  onInput={(event) => {
                    clearAdminControlValidity(event);
                    setExpiresAt(event.currentTarget.value);
                  }}
                />
              </AdminFormField>

              <fieldset class="border border-white/10 rounded-xl p-4">
                <legend class="px-2 text-xs font-mono uppercase tracking-[0.14em] text-base-content/80">
                  Scopes
                </legend>
                <label class="flex items-start gap-3 cursor-pointer min-h-12 py-2" for="mcp-scope-program-read">
                  <input
                    id="mcp-scope-program-read"
                    name="scope_program_read"
                    type="checkbox"
                    class="checkbox checkbox-secondary mt-1"
                    checked={scopes().includes("program:read")}
                    onChange={(event) => toggleScope("program:read", event.currentTarget.checked)}
                  />
                  <span>
                    <span class="block text-sm font-bold text-white font-mono">program:read</span>
                    <span class="block text-xs text-base-content/45 mt-1 leading-relaxed">
                      Read Sessions, Speakers, CFP Submissions, and review summaries for programme planning.
                    </span>
                  </span>
                </label>
              </fieldset>

              <button type="submit" class="btn btn-secondary font-mono w-full gap-2" disabled={saving()}>
                <Icon icon="ph:key-bold" aria-hidden="true" />
                <Show when={saving()} fallback="Create MCP Token">
                  Creating...
                </Show>
              </button>
            </div>
          </AdminFormSection>

          <Show when={createdToken()}>
            {(token) => (
              <section class="mt-6 border border-success/30 bg-success/10 rounded-2xl p-4" aria-live="polite">
                <div class="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 class="text-sm font-bold text-success uppercase tracking-[0.08em]">
                      Copy this token now
                    </h3>
                    <p class="text-xs text-base-content/60 font-mono mt-1">
                      It will not be shown again after you leave this page.
                    </p>
                  </div>
                  <button type="button" class="btn btn-sm btn-success font-mono" onClick={copyToken}>
                    Copy
                  </button>
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
                  <dd class="mt-1 rounded-xl bg-black/50 border border-white/10 p-3 font-mono text-secondary-200 break-all">
                    {mcpUrl()}
                  </dd>
                </div>
                <div>
                  <dt class="text-xs font-mono uppercase tracking-[0.14em] text-base-content/50">Header</dt>
                  <dd class="mt-1 rounded-xl bg-black/50 border border-white/10 p-3 font-mono text-secondary-200 break-all">
                    Authorization: Bearer wts_mcp_...
                  </dd>
                </div>
              </dl>
            </div>
          </AdminDataPanel>

          <AdminDataPanel>
            <div class="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between gap-4">
              <div>
                <h2 class="text-lg font-bold text-white">Tokens</h2>
                <p class="text-xs text-base-content/45 font-mono mt-1">
                  Revoke tokens you no longer use. Revoked and expired tokens cannot call MCP tools.
                </p>
              </div>
              <button type="button" class="btn btn-sm btn-ghost font-mono" onClick={() => refetch()}>
                Refresh
              </button>
            </div>

            <Show
              when={(tokens() || []).length > 0}
              fallback={
                <div class="p-8 text-center text-base-content/50 font-mono text-sm">
                  No MCP tokens yet.
                </div>
              }
            >
              <div class="divide-y divide-white/10">
                <For each={tokens() || []}>
                  {(token) => {
                    const status = tokenStatus(token);
                    return (
                      <article class="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2 mb-2">
                            <h3 class="text-base font-bold text-white truncate">{token.name}</h3>
                            <span class={`badge font-mono ${status.class}`}>{status.label}</span>
                          </div>
                          <div class="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono text-base-content/55">
                            <span>Prefix: {token.token_prefix}</span>
                            <span>Scopes: {token.scopes.join(", ") || "None"}</span>
                            <span>Expires: {formatDateTime(token.expires_at)}</span>
                            <span>Last used: {formatDateTime(token.last_used_at)}</span>
                            <Show when={token.revoked_at}>
                              <span>Revoked: {formatDateTime(token.revoked_at)}</span>
                            </Show>
                          </div>
                        </div>
                        <button
                          type="button"
                          class="btn btn-sm btn-outline btn-error font-mono lg:self-center"
                          disabled={!!token.revoked_at || busyId() === token.id}
                          onClick={() => revoke(token)}
                        >
                          <Show when={busyId() === token.id} fallback="Revoke">
                            Revoking...
                          </Show>
                        </button>
                      </article>
                    );
                  }}
                </For>
              </div>
            </Show>
          </AdminDataPanel>
        </div>
      </div>
    </AdminPageShell>
  );
}
