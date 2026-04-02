/// <reference path="../pb_data/types.d.ts" />

cronAdd("daily-report", "0 8 * * *", (e) => {
    try {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const since = yesterday.toISOString().replace("T", " ");

        // New users in last 24h
        const newUsers = e.app.findRecordsByFilter(
            "users",
            "created >= {:since}",
            "-created",
            0,
            0,
            { since: since }
        );

        // New CfP submissions in last 24h
        const newSubmissions = e.app.findRecordsByFilter(
            "cfp_submissions",
            "created >= {:since}",
            "-created",
            0,
            0,
            { since: since }
        );

        // Total counts
        const totalUsers = e.app.findRecordsByFilter("users", "", "", 0, 0);
        const totalSubmissions = e.app.findRecordsByFilter("cfp_submissions", "", "", 0, 0);

        // Ticket sales from HiEvents
        let ticketInfo = "Could not fetch ticket data";
        try {
            const hiUrl = $os.getenv("HIEVENTS_API_URL");
            const hiEventId = $os.getenv("HIEVENTS_EVENT_ID");
            const hiEmail = $os.getenv("HIEVENTS_EMAIL");
            const hiPassword = $os.getenv("HIEVENTS_PASSWORD");
            const hiAccountId = $os.getenv("HIEVENTS_ACCOUNT_ID");

            if (hiUrl && hiEventId && hiEmail && hiPassword) {
                // Authenticate
                const authRes = $http.send({
                    url: hiUrl + "/api/auth/login",
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Accept": "application/json" },
                    body: JSON.stringify({ email: hiEmail, password: hiPassword, account_id: hiAccountId }),
                });

                const token = JSON.parse(authRes.raw).token;

                // Fetch event data with products
                const eventRes = $http.send({
                    url: hiUrl + "/api/events/" + hiEventId + "/",
                    method: "GET",
                    headers: {
                        "Accept": "application/json",
                        "Authorization": "Bearer " + token,
                    },
                });

                const eventData = JSON.parse(eventRes.raw);
                const products = eventData.data.product_categories[0].products || [];

                let totalSold = 0;
                const lines = [];
                for (const p of products) {
                    const sold = p.quantity_sold || 0;
                    totalSold += sold;
                    lines.push(p.title + ": " + sold + " sold");
                }
                ticketInfo = lines.join("<br>") + "<br><strong>Total: " + totalSold + " tickets</strong>";
            }
        } catch (ticketErr) {
            e.app.logger().error("Daily report: failed to fetch tickets", "error", ticketErr);
        }

        // Build user details
        let newUsersList = "";
        for (const u of newUsers) {
            newUsersList += "<li>" + u.email() + " (" + (u.get("name") || "no name") + ")</li>";
        }

        let newSubmissionsList = "";
        for (const s of newSubmissions) {
            const title = s.get("session_title") || "Untitled";
            newSubmissionsList += "<li>" + title + "</li>";
        }

        const dateStr = now.toISOString().split("T")[0];
        const hasActivity = newUsers.length > 0 || newSubmissions.length > 0;

        if (!hasActivity) {
            // Skip sending if nothing happened
            e.app.logger().info("Daily report: no activity, skipping email");
            return;
        }

        const content = `
            <h2 style="margin: 0 0 15px 0; color: #333333;">Daily Report - ${dateStr}</h2>

            <h3 style="color: #333333; margin: 20px 0 10px 0;">New Users (last 24h): ${newUsers.length}</h3>
            ${newUsers.length > 0 ? "<ul>" + newUsersList + "</ul>" : "<p>None</p>"}

            <h3 style="color: #333333; margin: 20px 0 10px 0;">New CfP Submissions (last 24h): ${newSubmissions.length}</h3>
            ${newSubmissions.length > 0 ? "<ul>" + newSubmissionsList + "</ul>" : "<p>None</p>"}

            <h3 style="color: #333333; margin: 20px 0 10px 0;">Ticket Sales (all time)</h3>
            <p>${ticketInfo}</p>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p style="font-size: 13px; color: #888888;">
                Totals: ${totalUsers.length} users, ${totalSubmissions.length} submissions
            </p>
        `;

        const html = wtsEmailTemplate(e.app, "WTS Daily Report", content);

        const message = new MailerMessage({
            from: {
                address: e.app.settings().meta.senderAddress,
                name: e.app.settings().meta.senderName,
            },
            to: [{ address: "darko@wts.rocks" }],
            subject: "WTS Daily Report - " + dateStr,
            html: html,
        });

        e.app.newMailClient().send(message);
        e.app.logger().info("Daily report sent", "users", newUsers.length, "submissions", newSubmissions.length);

    } catch (err) {
        e.app.logger().error("Failed to send daily report", "error", err);
    }
});
