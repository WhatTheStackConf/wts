/// <reference path="../pb_data/types.d.ts" />

onRecordAfterCreateSuccess((e) => {
    const user = e.record;

    try {
        const username = $os.getenv("LISTMONK_USERNAME");
        const token = $os.getenv("LISTMONK_API_TOKEN") || $os.getenv("LISTMONK_PASSWORD");

        if (!username || !token) {
            e.app.logger().warn(
                "Listmonk sync skipped: set LISTMONK_USERNAME and LISTMONK_API_TOKEN (or LISTMONK_PASSWORD)",
            );
            e.next();
            return;
        }

        let baseUrl = $os.getenv("LISTMONK_URL") || "https://listmonk.wts.sh";
        baseUrl = baseUrl.replace(/\/+$/, "");

        let listId = 2;
        const listIdEnv = $os.getenv("LISTMONK_LIST_ID");
        if (listIdEnv) {
            const parsed = parseInt(listIdEnv, 10);
            if (!isNaN(parsed)) {
                listId = parsed;
            }
        }

        const email = user.email();
        const name = user.get("name") || "";

        const res = $http.send({
            url: baseUrl + "/api/subscribers",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Basic " + $security.base64Encode(username + ":" + token),
            },
            body: JSON.stringify({
                email: email,
                name: name,
                status: "enabled",
                lists: [listId],
                preconfirm_subscriptions: true,
            }),
        });

        if (res.statusCode >= 400 && res.statusCode !== 409) {
            e.app.logger().error("Failed to sync user to listmonk",
                "email", email,
                "status", res.statusCode,
                "body", res.raw,
            );
        }
    } catch (err) {
        e.app.logger().error("Listmonk sync error", "error", err);
    }

    e.next();
}, "users");
