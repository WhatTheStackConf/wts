import { createSignal, For, onSettled, Show, Switch, Match } from "solid-js";
import { executeStaffCommand, getAdminWorkspace, getStaffDirectory } from "~/lib/staff-actions";
import type { AdminWorkspace, DailyReportPolicy, StaffDirectory, StaffDirectoryEntry, StaffRole } from "~/lib/staff-model";
import { AdminError, AdminLoading, AdminSection, AdminStatus, useAdminRequest } from "~/components/admin/AdminUI";

export default function AdminStaffPage() {
  const [workspace, setWorkspace] = createSignal<AdminWorkspace>();
  const [directory, setDirectory] = createSignal<StaffDirectory>();
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [cfpOpen, setCfpOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [dailyReport, setDailyReport] = createSignal<DailyReportPolicy>({ enabled: false, timeZone: "UTC", localSendTime: "08:00" });
  const request = useAdminRequest();
  const hideAfterRequestFailure = (code?: string) => {
    if (code === undefined || code === "forbidden" || code === "unauthenticated" || code === "unavailable") {
      setWorkspace(undefined);
      setDirectory(undefined);
    }
  };

  const load = async (): Promise<boolean> => {
    setLoading(true);
    let loaded = false;
    try {
      const [workspaceResult, directoryResult] = await Promise.all([getAdminWorkspace(), getStaffDirectory()]);
      if (workspaceResult.ok && directoryResult.ok) {
        setWorkspace(workspaceResult.value);
        setDirectory(directoryResult.value);
        setCfpOpen(workspaceResult.value.cfpGate.open);
        setReviewOpen(workspaceResult.value.reviewPolicy.reviewOpen);
        setDailyReport(workspaceResult.value.reviewPolicy.dailyReport);
        request.clear();
        loaded = true;
      } else {
        const failure = !workspaceResult.ok ? workspaceResult.error : !directoryResult.ok ? directoryResult.error : undefined;
        if (failure) {
          request.setError({ code: failure.code, message: failure.message });
          if (failure.code === "forbidden" || failure.code === "unauthenticated" || failure.code === "unavailable" || failure.code === "not_found") {
            setWorkspace(undefined);
            setDirectory(undefined);
          }
        }
      }
    } catch {
      setWorkspace(undefined);
      setDirectory(undefined);
      request.setError({ code: "unavailable", message: "CFP staff settings could not be loaded. Retry when the service is available." });
    }
    setLoading(false);
    return loaded;
  };
  onSettled(() => { void load(); });

  const saveGrant = async (member: StaffDirectoryEntry, role: StaffRole, active: boolean) => {
    if (busy()) return;
    const grant = role === "admin" ? member.adminGrant : member.reviewerGrant;
    setBusy(true);
    const result = await request.run(() => executeStaffCommand({
      kind: "set-grant",
      requestId: crypto.randomUUID(),
      wtsUserId: member.wtsUserId,
      role,
      expectedRevision: grant?.revision ?? 0,
      active,
    }));
    if (result?.ok) {
      if (await load()) request.saved(`${role === "admin" ? "Administrator" : "Reviewer"} access ${active ? "granted" : "revoked"} for ${member.wtsUserId}.`);
    } else {
      hideAfterRequestFailure(result?.error.code);
    }
    setBusy(false);
  };

  const saveCfpGate = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = workspace();
    if (!current || busy()) return;
    setBusy(true);
    const result = await request.run(() => executeStaffCommand({ kind: "set-cfp-gate", requestId: crypto.randomUUID(), expectedRevision: current.cfpGate.revision, open: cfpOpen() }));
    if (result?.ok) {
      if (await load()) request.saved(`CFP intake ${cfpOpen() ? "opened" : "closed"}.`);
    } else {
      hideAfterRequestFailure(result?.error.code);
    }
    setBusy(false);
  };

  const saveReviewPolicy = async (event: SubmitEvent) => {
    event.preventDefault();
    const current = workspace();
    if (!current || busy()) return;
    setBusy(true);
    const result = await request.run(() => executeStaffCommand({ kind: "set-review-policy", requestId: crypto.randomUUID(), expectedRevision: current.reviewPolicy.revision, reviewOpen: reviewOpen(), dailyReport: dailyReport() }));
    if (result?.ok) {
      if (await load()) request.saved("Review and daily report policy saved.");
    } else {
      hideAfterRequestFailure(result?.error.code);
    }
    setBusy(false);
  };

  const active = (grant: StaffDirectoryEntry["adminGrant"] | StaffDirectoryEntry["reviewerGrant"]) => grant?.state === "active";

  return <>
    <header class="page-heading">
      <h1>CFP staff and gates</h1>
      <p>Manage roles for known WTS identities and set independent edition controls.</p>
      <Show when={workspace()}><p class="mono">Edition <strong>{workspace()?.editionId}</strong></p></Show>
    </header>
    <nav class="row" aria-label="CFP administration"><a class="button button-secondary button-small" href="/admin">Proposals</a><a class="button button-secondary button-small" href="/admin/staff" aria-current="page">Staff and gates</a></nav>
    <Switch>
      <Match when={loading()}><AdminLoading label="Loading edition staff and controls…" /></Match>
      <Match when={request.error()?.code === "unauthenticated"}><AdminError state="unauthenticated" message={request.error()?.message} /></Match>
      <Match when={request.error()?.code === "forbidden"}><AdminError state="denied" message="Your edition administrator access is not active. Protected staff data is hidden." /></Match>
      <Match when={request.error() && request.error()?.code !== "forbidden" && request.error()?.code !== "unauthenticated"}><AdminError state={request.error()?.code === "last_admin" ? "last-admin" : request.error()?.code === "conflict" ? "stale" : "unavailable"} message={request.error()?.message} onRetry={() => void load()} /></Match>
      <Match when={workspace() && directory()}>
        <div class="cfp-stack">
          <Show when={request.savedMessage()}><p class="alert" role="status">{request.savedMessage()}</p></Show>
          <AdminSection title="Edition gates" description="CFP intake and review access use separate revision-checked controls.">
            <form onSubmit={saveCfpGate} class="cfp-stack">
              <fieldset><legend>CFP application intake · revision {workspace()!.cfpGate.revision}</legend>
                <label class="label cursor-pointer justify-start gap-3"><input class="toggle" type="checkbox" name="cfpOpen" checked={cfpOpen()} onChange={(event) => setCfpOpen(event.currentTarget.checked)} /><span>{cfpOpen() ? "Open" : "Closed"}</span></label>
                <button class="button" type="submit" disabled={busy() || cfpOpen() === workspace()!.cfpGate.open}>Save CFP gate</button>
              </fieldset>
            </form>
            <form onSubmit={saveReviewPolicy} class="cfp-stack">
              <fieldset class="cfp-stack"><legend>Review access and daily report policy · revision {workspace()!.reviewPolicy.revision}</legend>
                <label class="label cursor-pointer justify-start gap-3"><input class="toggle" type="checkbox" name="reviewOpen" checked={reviewOpen()} onChange={(event) => setReviewOpen(event.currentTarget.checked)} /><span>{reviewOpen() ? "Reviewing open" : "Reviewing closed"}</span></label>
                <label class="label cursor-pointer justify-start gap-3"><input class="toggle" type="checkbox" name="dailyReportEnabled" checked={dailyReport().enabled} onChange={(event) => setDailyReport((value) => ({ ...value, enabled: event.currentTarget.checked }))} /><span>{dailyReport().enabled ? "Daily CFP report enabled" : "Daily CFP report disabled"}</span></label>
                <label>Daily report time (UTC)
                  <input class="control" type="time" name="localSendTime" required value={dailyReport().localSendTime} onChange={(event) => setDailyReport((value) => ({ ...value, localSendTime: event.currentTarget.value }))} />
                </label>
                <p>Daily reports are disabled until an admin explicitly enables them. The report includes CFP activity only.</p>
                <button class="button" type="submit" disabled={busy() || (reviewOpen() === workspace()!.reviewPolicy.reviewOpen && dailyReport().enabled === workspace()!.reviewPolicy.dailyReport.enabled && dailyReport().localSendTime === workspace()!.reviewPolicy.dailyReport.localSendTime)}>Save review and report policy</button>
              </fieldset>
            </form>
            <div><h3>Mail delivery state</h3><p>Mode: {workspace()!.mail.mode} · {workspace()!.mail.configured ? "configured" : "not configured"}</p>
              <dl class="read-only-summary">
                <div><dt>Queued</dt><dd>{workspace()!.mail.queued}</dd></div><div><dt>Retrying</dt><dd>{workspace()!.mail.retrying}</dd></div><div><dt>Sent</dt><dd>{workspace()!.mail.sent}</dd></div><div><dt>Failed</dt><dd>{workspace()!.mail.failed}</dd></div><div><dt>Suspended</dt><dd>{workspace()!.mail.suspended}</dd></div><div><dt>Delivery unknown</dt><dd>{workspace()!.mail.deliveryUnknown}</dd></div><div><dt>Eligible daily recipients</dt><dd>{workspace()!.mail.eligibleDailyRecipientCount}</dd></div>
              </dl>
              <p>Recipient addresses and mail credentials are not available in this staff interface.</p>
            </div>
          </AdminSection>

          <AdminSection title="Known WTS identities" description="Only local accounts appear. These edition grants do not create or change central accounts.">
            <p>Active edition administrators: {directory()!.activeAdminCount}. Revocation of the final active administrator is disabled here and remains protected by the server.</p>
            <Show when={directory()!.members.length} fallback={<p class="empty-state">No locally known WTS identities are available for this edition.</p>}>
              <div class="overflow-x-auto admin-table-wrapper" tabindex="0" aria-label="Scrollable WTS staff directory">
                <table class="table table-zebra min-w-[52rem] admin-table"><caption class="sr-only">Known accounts and current edition roles</caption>
                  <thead><tr><th>WTS identity</th><th>Admin access</th><th>Reviewer access</th><th>Assignments</th><th>Saved reviews</th></tr></thead>
                  <tbody><For each={directory()!.members}>{(member) => <tr>
                    <th>{member.speakerName || "Known WTS account"}<br /><span class="mono">{member.wtsUserId}</span></th>
                    <td><div class="cfp-stack"><AdminStatus state={member.adminGrant?.state ?? "revoked"} label={member.adminGrant?.state ?? "not granted"} /><button class="button button-secondary button-small" type="button" disabled={busy() || (active(member.adminGrant) && directory()!.activeAdminCount <= 1)} onClick={() => void saveGrant(member, "admin", !active(member.adminGrant))}>{active(member.adminGrant) ? "Revoke admin" : "Grant admin"}</button></div></td>
                    <td><div class="cfp-stack"><AdminStatus state={member.reviewerGrant?.state ?? "revoked"} label={member.reviewerGrant?.state ?? "not granted"} /><button class="button button-secondary button-small" type="button" disabled={busy()} onClick={() => void saveGrant(member, "reviewer", !active(member.reviewerGrant))}>{active(member.reviewerGrant) ? "Revoke reviewer" : "Grant reviewer"}</button></div></td>
                    <td>{member.activeAssignmentCount}</td><td>{member.reviewCount}</td>
                  </tr>}</For></tbody>
                </table>
              </div>
            </Show>
          </AdminSection>
        </div>
      </Match>
    </Switch>
  </>;
}
