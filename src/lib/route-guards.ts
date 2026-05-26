import { createEffect, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useAuth } from "~/lib/auth-context";
import type { UserRecord } from "~/lib/pocketbase-types";

export function useRequireAdmin() {
    const auth = useAuth();
    const navigate = useNavigate();

    const isLoading = () => auth.isLoading();

    const authorized = createMemo(() => {
        if (auth.isLoading()) return false;
        return auth.isAuthenticated() && auth.user?.role === "admin";
    });

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login");
            return;
        }
        if (auth.user?.role !== "admin") {
            navigate("/");
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
        if (auth.isLoading()) return false;
        if (!auth.isAuthenticated()) return false;
        const role = auth.user?.role;
        return role === "reviewer" || role === "admin";
    });

    createEffect(() => {
        if (auth.isLoading()) return;
        if (!auth.isAuthenticated()) {
            navigate("/login");
            return;
        }
        const role = auth.user?.role;
        if (role !== "reviewer" && role !== "admin") {
            navigate("/");
        }
    });

    const user = createMemo((): UserRecord | null =>
        authorized() ? (auth.user as UserRecord) : null,
    );

    return { isLoading, authorized, user };
}
