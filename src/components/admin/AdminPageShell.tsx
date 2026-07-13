import { createSignal, JSX, onCleanup, Show, ParentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "@iconify-icon/solid";
import { Layout } from "~/layouts/Layout";

export type AdminToast = {
  type: "success" | "error";
  text: string;
  actionHref?: string;
  actionLabel?: string;
};

type AdminControlElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function useAdminToast() {
  const [toast, setToast] = createSignal<AdminToast | null>(null);
  let hideTimer: number | undefined;

  const showToast = (
    type: AdminToast["type"],
    text: string,
    action?: Pick<AdminToast, "actionHref" | "actionLabel">,
  ) => {
    if (hideTimer) window.clearTimeout(hideTimer);
    setToast({ type, text, ...action });
    hideTimer = window.setTimeout(() => setToast(null), 6000);
  };

  onCleanup(() => {
    if (hideTimer) window.clearTimeout(hideTimer);
  });

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
  "admin-control w-full bg-black/40 border-white/15 text-base-content placeholder:text-base-content/60 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-300 transition-[border-color,box-shadow,background-color] duration-200";

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
        <h3 class="text-sm font-bold text-white uppercase tracking-[0.06em] text-wrap-balance">{props.title}</h3>
        <Show when={props.description}>
          <p class="text-xs text-base-content/60 font-mono mt-1 max-w-3xl leading-relaxed text-pretty">
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
      <span class="admin-label block text-base-content/85 font-mono text-xs uppercase tracking-[0.12em] mb-1.5">
        {props.label}
        <Show when={props.required}>
          <span aria-hidden="true" class="text-primary-300 ml-1">
            *
          </span>
          <span class="sr-only"> required</span>
        </Show>
      </span>
      <Show when={props.hint}>
        <span id={`${props.id}-hint`} class="admin-hint block text-xs text-base-content/60 font-mono mb-2 max-w-prose leading-relaxed text-pretty">
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
      <div class="min-h-screen w-full min-w-0 max-w-full pt-24 pb-20 relative overflow-hidden">
        <div
          class={`absolute top-0 right-0 w-[500px] h-[500px] ${orbTopClass()} rounded-full blur-[120px] -z-10 pointer-events-none`}
        />
        <div
          class={`absolute bottom-0 left-0 w-[500px] h-[500px] ${orbBottomClass()} rounded-full blur-[120px] -z-10 pointer-events-none`}
        />

        <div class="container mx-auto w-full min-w-0 max-w-7xl px-4">
          <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
            <div class="min-w-0">
              <h1 class={`flex flex-wrap items-center gap-x-3 gap-y-2 text-3xl md:text-4xl font-black uppercase tracking-tight ${titleClass()} mb-2 text-wrap-balance`}>
                <span class="min-w-0 [overflow-wrap:anywhere]">{props.title}</span>
                <Show when={!props.countLoading && props.count !== undefined}>
                  <span
                    class={`badge badge-lg font-mono font-black ${badgeClass()}`}
                  >
                    {props.count}
                  </span>
                </Show>
              </h1>
              <p class="text-secondary-200 font-mono text-sm uppercase tracking-[0.14em] leading-relaxed">
                {props.subtitle}
              </p>
              <Show when={props.hint}>
                <p class="text-xs text-base-content/60 font-mono mt-2 max-w-2xl leading-relaxed text-pretty">{props.hint}</p>
              </Show>
            </div>
            <div class="flex flex-wrap items-center gap-2 md:justify-end">
              <Show when={props.headerActions}>{props.headerActions}</Show>
              <button
                type="button"
                class="btn btn-ghost hover:bg-white/10 text-white gap-2 group shrink-0"
                onClick={() => navigate("/admin")}
              >
                <Icon
                  icon="ph:arrow-left-bold"
                  class="motion-safe:group-hover:-translate-x-1 transition-transform"
                  aria-hidden="true"
                />
                Back to dashboard
              </button>
            </div>
          </div>

          <Show when={props.toast}>
            {(t) => (
              <div
                class={`alert mb-6 flex-col items-start gap-3 font-mono text-sm sm:flex-row sm:items-center sm:justify-between ${
                  t().type === "success" ? "alert-success" : "alert-error"
                }`}
                role={t().type === "error" ? "alert" : "status"}
                aria-live={t().type === "error" ? "assertive" : "polite"}
              >
                <span>{t().text}</span>
                <Show when={t().actionHref && t().actionLabel}>
                  <a href={t().actionHref} class="btn btn-sm btn-ghost font-mono">
                    {t().actionLabel}
                  </a>
                </Show>
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
        <Icon icon="ph:funnel-bold" class="text-base-content/65" aria-hidden="true" />
        <span class="text-xs font-mono text-base-content/65 uppercase tracking-[0.08em]">Filters</span>
      </div>
      {props.children}
      <Show when={props.showCount}>
        <span class="text-xs font-mono text-base-content/60">
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
    <div class="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={props.label.replace(/:$/, "")}>
      <span class="text-xs font-mono text-base-content/60">{props.label}</span>
      <div class="flex min-w-0 flex-wrap gap-1">{props.children}</div>
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
  return "btn btn-xs font-mono btn-ghost border-white/15 text-base-content/70 hover:bg-white/10 hover:text-white";
}
