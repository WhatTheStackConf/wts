import { createEffect, createMemo } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import type { UserRecord } from "~/lib/pocketbase-types";
import {
    adminAuthorized,
    authenticated,
    checkinOperatorAuthorized,
    reviewerAuthorized,
} from "~/lib/route-authorization";
import { createAsyncResource } from "~/lib/async-resource";
import { capabilityForPath } from "~/lib/conference-capability-policy";
import { capabilityAvailableForClient } from "~/lib/capability-availability";

function scheduleRedirect(navigate: ReturnType<typeof useNavigate>, path: string) {
  queueMicrotask(() => navigate(path, { replace: true }));
}
export function useCapabilityRouteAvailability() {
    const location = useLocation();
    const required = () => capabilityForPath(location.pathname) ?? undefined;
    const [decision] = createAsyncResource(required, async (capability) => ({
        capability,
        available: await capabilityAvailableForClient(capability),
    }));
    const checking = () => {
        const capability = required();
        return !!capability && (
            decision.loading ||
            (decision.error === undefined && decision()?.capability !== capability)
        );
    };
    const available = () => {
        const capability = required();
        if (!capability) return true;
        const result = decision();
        return !checking() && result?.available === true;
    };
    return { required, checking, available };
}

export function useRequireAdmin() {
    const auth = useAuth();
    const navigate = useNavigate();
    const capability = useCapabilityRouteAvailability();

    const isLoading = () => auth.isLoading() || capability.checking();
    const authorized = createMemo(() => capability.available() && adminAuthorized({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
    }));

    createEffect(
      () => ({
        loading: isLoading(),
        capabilityAvailable: capability.available(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
      }),
      ({ loading, capabilityAvailable, authenticated, role }) => {
        if (loading || !capabilityAvailable) return;
        if (!authenticated) {
            scheduleRedirect(navigate, "/login");
            return;
        }
        if (role !== "admin") scheduleRedirect(navigate, "/");
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );

    return { isLoading, authorized, user };
}

export function useRequireReviewer() {
    const auth = useAuth();
    const navigate = useNavigate();
    const capability = useCapabilityRouteAvailability();

    const isLoading = () => auth.isLoading() || capability.checking();
    const authorized = createMemo(() => capability.available() && reviewerAuthorized({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
    }));

    createEffect(
      () => ({
        loading: isLoading(),
        capabilityAvailable: capability.available(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
      }),
      ({ loading, capabilityAvailable, authenticated, role }) => {
        if (loading || !capabilityAvailable) return;
        if (!authenticated) {
            scheduleRedirect(navigate, "/login");
            return;
        }
        if (role !== "reviewer" && role !== "admin") scheduleRedirect(navigate, "/");
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );

    return { isLoading, authorized, user };
}

/** UI gate for /checkin; every operation also refreshes server-side authority. */
export function useRequireCheckinOperator(returnPath: "/checkin" | "/registrations" = "/checkin") {
    const auth = useAuth();
    const navigate = useNavigate();
    const authorized = createMemo(() => checkinOperatorAuthorized({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
    }));

    createEffect(
      () => ({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        authorized: authorized(),
      }),
      ({ loading, authenticated, authorized }) => {
        if (loading) return;
        if (!authenticated) {
            try {
                // Provisioning QR material must never persist across login.
                window.localStorage.setItem("redirect_url", returnPath);
            } catch {
                // Login still works when browser storage is unavailable.
            }
            scheduleRedirect(navigate, "/login");
            return;
        }
        if (!authorized) scheduleRedirect(navigate, "/");
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );
    return { isLoading: auth.isLoading, authorized, user };
}

export function useRequireAuth() {
    const auth = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const capability = useCapabilityRouteAvailability();
    const isLoading = () => auth.isLoading() || capability.checking();
    const authorized = createMemo(() => capability.available() && authenticated({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
    }));

    createEffect(
      () => ({
        loading: isLoading(),
        capabilityAvailable: capability.available(),
        authenticated: auth.isAuthenticated(),
        destination: `${location.pathname}${location.search}${location.hash}`,
      }),
      ({ loading, capabilityAvailable, authenticated, destination }) => {
        if (loading || !capabilityAvailable || authenticated) return;
        try {
            window.localStorage.setItem("redirect_url", destination);
        } catch {
            // Login still works when browser storage is unavailable.
        }
        scheduleRedirect(navigate, "/login");
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );
    return { isLoading, authorized, user };
}
