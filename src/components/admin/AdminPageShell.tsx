import { createSignal, JSX, Show, ParentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

export type AdminToast = { type: "success" | "error"; text: string };

type AdminControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function useAdminToast() {
  const [toast, setToast] = createSignal<AdminToast | null>(null);

  const showToast = (type: AdminToast["type"], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 6000);
  };

  return { toast, showToast };
}

export function markAdminControlInvalid(event: Event) {
  const control = event.currentTarget as AdminControlElement;
  control.setAttribute("aria-invalid", "true");
}

export function syncAdminControlValidity(event: Event) {
  const control = event.currentTarget as AdminControlElement;
  if (control.checkValidity()) {
    control.removeAttribute("aria-invalid");
    return;
  }
  control.setAttribute("aria-invalid", "true");
}

export function clearAdminControlValidity(event: Event) {
  const control = event.currentTarget as AdminControlElement;
  if (control.checkValidity()) control.removeAttribute("aria-invalid");
}

const ADMIN_CONTROL_BASE =
  "admin-control w-full bg-black/40 border-white/10 text-base-content placeholder:text-base-content/35 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-[border-color,box-shadow,background-color] duration-200";

export const adminFormPanelClass =
  "glass-panel p-5 sm:p-6 rounded-2xl border border-white/10 shadow-xl backdrop-blur-xl bg-black/40";

export function adminInputClass(extra = "") {
  return `input input-bordered ${ADMIN_CONTROL_BASE} ${extra}`;
}

export function adminTextareaClass(extra = "") {
  return `textarea textarea-bordered ${ADMIN_CONTROL_BASE} leading-relaxed ${extra}`;
}

export function adminSelectClass(extra = "") {
  return `select select-bordered ${ADMIN_CONTROL_BASE} ${extra}`;
}

export function adminFileInputClass(extra = "") {
  return `file-input file-input-bordered w-full ${ADMIN_CONTROL_BASE} ${extra}`;
}

interface AdminFormSectionProps extends ParentProps {
  title: string;
  description?: string;
  class?: string;
}

export function AdminFormSection(props: AdminFormSectionProps) {
  return (
    <section class={`admin-form-section border-t border-white/10 pt-6 first:border-t-0 first:pt-0 ${props.class ?? ""}`}>
      <div class="mb-4">
        <h3 class="text-sm font-bold text-white uppercase tracking-[0.08em]">{props.title}</h3>
        <Show when={props.description}>
          <p class="text-xs text-base-content/45 font-mono mt-1 max-w-3xl">
            {props.description}
          </p>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

interface AdminFormFieldProps extends ParentProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  class?: string;
}

export function AdminFormField(props: AdminFormFieldProps) {
  return (
    <label class={`admin-field block w-full ${props.class ?? ""}`} for={props.id}>
      <span class="admin-label block text-base-content/80 font-mono text-xs uppercase tracking-[0.14em] mb-1.5">
        {props.label}
        <Show when={props.required}>
          <span aria-hidden="true" class="text-primary-300 ml-1">
            *
          </span>
        </Show>
      </span>
      <Show when={props.hint}>
        <span id={`${props.id}-hint`} class="admin-hint block text-xs text-base-content/45 font-mono mb-2 max-w-prose leading-relaxed">
          {props.hint}
        </span>
      </Show>
      {props.children}
      <Show when={props.error}>
        <span id={`${props.id}-error`} class="admin-error text-xs font-mono mt-2 items-center gap-1.5">
          <Icon icon="ph:warning-circle-bold" aria-hidden="true" />
          {props.error}
        </span>
      </Show>
    </label>
  );
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

  const titleClass = () =>
    accent() === "secondary" ? "text-secondary-100" : "text-primary-100";

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
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
            <div>
              <h1 class={`text-3xl md:text-4xl font-black uppercase tracking-tight ${titleClass()} mb-2`}>
                <span>{props.title}</span>
                <Show when={!props.countLoading && props.count !== undefined}>
                  <span
                    class={`ml-3 align-middle badge badge-lg font-mono font-black ${badgeClass()}`}
                  >
                    {props.count}
                  </span>
                </Show>
              </h1>
              <p class="text-secondary-300 font-mono text-sm uppercase tracking-[0.16em]">
                {props.subtitle}
              </p>
              <Show when={props.hint}>
                <p class="text-xs text-base-content/45 font-mono mt-2 max-w-2xl">{props.hint}</p>
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
                Back to dashboard
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
