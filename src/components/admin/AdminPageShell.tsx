import { createSignal, JSX, Show, ParentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

export type AdminToast = { type: "success" | "error"; text: string };

export function useAdminToast() {
  const [toast, setToast] = createSignal<AdminToast | null>(null);

  const showToast = (type: AdminToast["type"], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 6000);
  };

  return { toast, showToast };
}

interface AdminPageShellProps extends ParentProps {
  layoutTitle: string;
  layoutDescription: string;
  title: string;
  subtitle: string;
  hint?: string;
  count?: number;
  countLoading?: boolean;
  accent?: "primary" | "secondary";
  headerActions?: JSX.Element;
  toast?: AdminToast | null;
}

export function AdminPageShell(props: AdminPageShellProps) {
  const navigate = useNavigate();
  const accent = () => props.accent ?? "primary";

  const gradientClass = () =>
    accent() === "secondary"
      ? "from-primary-400 to-secondary-400"
      : "from-primary-400 to-white";

  const badgeClass = () =>
    accent() === "secondary"
      ? "bg-secondary-500/20 border-secondary-500/40 text-secondary-300"
      : "bg-primary-500/20 border-primary-500/40 text-primary-300";

  const orbTopClass = () =>
    accent() === "secondary" ? "bg-secondary-900/10" : "bg-primary-900/10";

  const orbBottomClass = () =>
    accent() === "secondary" ? "bg-primary-900/10" : "bg-secondary-900/10";

  return (
    <Layout title={props.layoutTitle} description={props.layoutDescription}>
      <div class="min-h-screen pt-24 pb-20 relative overflow-hidden">
        <div
          class={`absolute top-0 right-0 w-[500px] h-[500px] ${orbTopClass()} rounded-full blur-[120px] -z-10 pointer-events-none`}
        />
        <div
          class={`absolute bottom-0 left-0 w-[500px] h-[500px] ${orbBottomClass()} rounded-full blur-[120px] -z-10 pointer-events-none`}
        />

        <div class="container mx-auto px-4 max-w-7xl">
          <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-4">
            <div>
              <h1
                class={`text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${gradientClass()} uppercase drop-shadow-sm mb-2`}
              >
                {props.title}
                <Show when={!props.countLoading && props.count !== undefined}>
                  <span
                    class={`ml-3 align-middle badge badge-lg font-mono font-black ${badgeClass()}`}
                  >
                    {props.count}
                  </span>
                </Show>
              </h1>
              <p class="text-secondary-300 font-mono text-sm uppercase">{props.subtitle}</p>
              <Show when={props.hint}>
                <p class="text-xs text-gray-500 font-mono mt-1">{props.hint}</p>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Show when={props.headerActions}>{props.headerActions}</Show>
              <button
                type="button"
                class="btn btn-ghost hover:bg-white/10 text-white gap-2 group"
                onClick={() => navigate("/admin")}
              >
                <Icon
                  icon="ph:arrow-left-bold"
                  class="group-hover:-translate-x-1 transition-transform"
                />
                Back to Dashboard
              </button>
            </div>
          </div>

          <Show when={props.toast}>
            {(t) => (
              <div
                class={`alert mb-6 font-mono text-sm ${
                  t().type === "success" ? "alert-success" : "alert-error"
                }`}
                role="status"
              >
                <span>{t().text}</span>
              </div>
            )}
          </Show>

          {props.children}
        </div>
      </div>
    </Layout>
  );
}

/** Glass data container matching Proposals/Users gold standard */
export function AdminDataPanel(props: ParentProps) {
  return (
    <div class="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl bg-black/40">
      {props.children}
    </div>
  );
}

interface AdminFilterBarProps extends ParentProps {
  filteredCount?: number;
  totalCount?: number;
  showCount?: boolean;
}

export function AdminFilterBar(props: AdminFilterBarProps) {
  return (
    <div class="flex flex-wrap gap-3 mb-6 items-center">
      <div class="flex items-center gap-2">
        <Icon icon="ph:funnel-bold" class="text-gray-400" />
        <span class="text-xs font-mono text-gray-400 uppercase">Filters</span>
      </div>
      {props.children}
      <Show when={props.showCount}>
        <span class="text-xs font-mono text-gray-500">
          {props.filteredCount} / {props.totalCount}
        </span>
      </Show>
    </div>
  );
}

interface AdminFilterGroupProps {
  label: string;
  children: JSX.Element;
}

export function AdminFilterGroup(props: AdminFilterGroupProps) {
  return (
    <div class="flex items-center gap-2">
      <label class="text-xs font-mono text-gray-500">{props.label}</label>
      <div class="flex gap-1">{props.children}</div>
    </div>
  );
}

export function adminFilterButtonClass(
  active: boolean,
  variant: "primary" | "secondary" = "primary",
) {
  if (active) {
    return variant === "secondary"
      ? "btn btn-xs font-mono btn-secondary"
      : "btn btn-xs font-mono btn-primary";
  }
  return "btn btn-xs font-mono btn-ghost border-white/10 text-gray-400 hover:bg-white/10";
}
