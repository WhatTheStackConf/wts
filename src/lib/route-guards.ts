import { createEffect, createMemo } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import type { UserRecord } from "~/lib/pocketbase-types";
import {
    adminAuthorized,
    authenticated,
    reviewerAuthorized,
} from "~/lib/route-authorization";

function scheduleRedirect(navigate: ReturnType<typeof useNavigate>, path: string) {
  queueMicrotask(() => navigate(path, { replace: true }));
}

export function useRequireAdmin() {
    const auth = useAuth();
    const navigate = useNavigate();

    const isLoading = () => auth.isLoading();

    const authorized = createMemo(() => {
        return adminAuthorized({
            loading: auth.isLoading(),
            authenticated: auth.isAuthenticated(),
            role: auth.user?.role,
        });
    });

    createEffect(
      () => ({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
      }),
      ({ loading, authenticated, role }) => {
        if (loading) return;
        if (!authenticated) {
            scheduleRedirect(navigate, "/login");
            return;
        }
        if (role !== "admin") {
            scheduleRedirect(navigate, "/");
        }
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

    const isLoading = () => auth.isLoading();

    const authorized = createMemo(() => {
        return reviewerAuthorized({
            loading: auth.isLoading(),
            authenticated: auth.isAuthenticated(),
            role: auth.user?.role,
        });
    });

    createEffect(
      () => ({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
      }),
      ({ loading, authenticated, role }) => {
        if (loading) return;
        if (!authenticated) {
            scheduleRedirect(navigate, "/login");
            return;
        }
        if (role !== "reviewer" && role !== "admin") {
            scheduleRedirect(navigate, "/");
        }
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );

    return { isLoading, authorized, user };
}

export function useRequireAuth() {
    const auth = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const authorized = createMemo(() => authenticated({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        role: auth.user?.role,
    }));

    createEffect(
      () => ({
        loading: auth.isLoading(),
        authenticated: auth.isAuthenticated(),
        destination: `${location.pathname}${location.search}${location.hash}`,
      }),
      ({ loading, authenticated, destination }) => {
        if (!loading && !authenticated) {
            try {
                window.localStorage.setItem("redirect_url", destination);
            } catch {
                // Login still works when browser storage is unavailable.
            }
            scheduleRedirect(navigate, "/login");
        }
      },
    );

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );
    return { isLoading: auth.isLoading, authorized, user };
}
