import { createEffect, createMemo } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import type { UserRecord } from "~/lib/pocketbase-types";
import {
    adminAuthorized,
    authenticated,
    reviewerAuthorized,
} from "~/lib/route-authorization";

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

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login", { replace: true });
            return;
        }
        if (auth.user?.role !== "admin") {
            navigate("/", { replace: true });
        }
    });

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

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login", { replace: true });
            return;
        }
        const role = auth.user?.role;
        if (role !== "reviewer" && role !== "admin") {
            navigate("/", { replace: true });
        }
    });

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

    createEffect(() => {
        if (!auth.isLoading() && !auth.isAuthenticated()) {
            const destination = `${location.pathname}${location.search}${location.hash}`;
            try {
                window.localStorage.setItem("redirect_url", destination);
            } catch {
                // Login still works when browser storage is unavailable.
            }
            navigate("/login", { replace: true });
        }
    });

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );
    return { isLoading: auth.isLoading, authorized, user };
}
