/// <reference path="../pb_data/types.d.ts" />

onRecordAfterCreateSuccess((e) => {
    const user = e.record;

    try {
        const email = user.email();
        const name = user.get("name") || "";

        const res = $http.send({
            url: "https://listmonk.wts.sh/api/subscribers",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Basic " + $security.base64Encode(
                    $os.getenv("LISTMONK_USERNAME") + ":" + $os.getenv("LISTMONK_API_TOKEN")
                ),
            },
            body: JSON.stringify({
                email: email,
                name: name,
                status: "enabled",
                lists: [2],
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
