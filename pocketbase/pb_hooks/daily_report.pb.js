/// <reference path="../pb_data/types.d.ts" />

cronAdd("daily-report", "0 8 * * *", () => {
    function ticketLines(products) {
        let totalSold = 0;
        const lines = [];
        for (const p of products) {
            const sold = p.quantity_sold || 0;
            totalSold += sold;
            lines.push(p.title + ": " + sold + " sold");
        }
        return lines.join("<br>") + "<br><strong>Total: " + totalSold + " tickets</strong>";
    }

    function fetchTicketSales(hiUrl, hiEventId, hiEmail, hiPassword, hiAccountId) {
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
        return ticketLines(eventData.data.product_categories[0].products || []);
    }

    function ticketInfo() {
        try {
            const hiUrl = $os.getenv("HIEVENTS_API_URL");
            const hiEventId = $os.getenv("HIEVENTS_EVENT_ID");
            const hiEmail = $os.getenv("HIEVENTS_EMAIL");
            const hiPassword = $os.getenv("HIEVENTS_PASSWORD");
            const hiAccountId = $os.getenv("HIEVENTS_ACCOUNT_ID");

            if (hiUrl && hiEventId && hiEmail && hiPassword) {
                return fetchTicketSales(hiUrl, hiEventId, hiEmail, hiPassword, hiAccountId);
            }
        } catch (ticketErr) {
            $app.logger().error("Daily report: failed to fetch tickets", "error", ticketErr);
        }
        return "Could not fetch ticket data";
    }

    function recordList(records, render) {
        let list = "";
        for (const record of records) list += "<li>" + render(record) + "</li>";
        return list;
    }

    function listOrNone(records, list) {
        return records.length > 0 ? "<ul>" + list + "</ul>" : "<p>None</p>";
    }

    function reportRecipients() {
        const recipientEnv = $os.getenv("CFP_DAILY_REPORT_RECIPIENT") || "darko@wts.rocks";
        const recipients = recipientEnv.split(",").map((addr) => addr.trim()).filter((addr) => addr.length > 0);
        return recipients.map((address) => ({ address }));
    }

    try {
        const now = (() => { if (!require(__hooks + "/capability-availability.js").isAvailable($app, "cfp")) throw new Error("CFP report unavailable."); return new Date(); })();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const since = yesterday.toISOString().replace("T", " ");

        // New users in last 24h
        const newUsers = $app.findRecordsByFilter(
            "users",
            "created >= {:since}",
            "-created",
            0,
            0,
            { since: since }
        );

        // New CfP submissions in last 24h
        const newSubmissions = $app.findRecordsByFilter(
            "cfp_submissions",
            "created >= {:since}",
            "-created",
            0,
            0,
            { since: since }
        );

        // Total counts
        const totalUsers = $app.findRecordsByFilter("users", "", "", 0, 0);
        const totalSubmissions = $app.findRecordsByFilter("cfp_submissions", "", "", 0, 0);

        const tickets = ticketInfo();

        const newUsersList = recordList(newUsers, (u) => u.email() + " (" + (u.get("name") || "no name") + ")");
        const newSubmissionsList = recordList(newSubmissions, (s) => s.get("session_title") || "Untitled");

        const dateStr = now.toISOString().split("T")[0];

        const content = `
            <h2 style="margin: 0 0 15px 0; color: #333333;">Daily Report - ${dateStr}</h2>

            <h3 style="color: #333333; margin: 20px 0 10px 0;">New Users (last 24h): ${newUsers.length}</h3>
            ${listOrNone(newUsers, newUsersList)}

            <h3 style="color: #333333; margin: 20px 0 10px 0;">New CfP Submissions (last 24h): ${newSubmissions.length}</h3>
            ${listOrNone(newSubmissions, newSubmissionsList)}

            <h3 style="color: #333333; margin: 20px 0 10px 0;">Ticket Sales (all time)</h3>
            <p>${tickets}</p>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p style="font-size: 13px; color: #888888;">
                Totals: ${totalUsers.length} users, ${totalSubmissions.length} submissions
            </p>
        `;

        const html = wtsEmailTemplate($app, "WTS Daily Report", content);

        const to = reportRecipients();

        const message = new MailerMessage({
            from: {
                address: $app.settings().meta.senderAddress,
                name: $app.settings().meta.senderName,
            },
            to: to,
            subject: "WTS Daily Report - " + dateStr,
            html: html,
        });

        $app.newMailClient().send(message);
        $app.logger().info("Daily report sent", "users", newUsers.length, "submissions", newSubmissions.length);

    } catch (err) {
        $app.logger().error("Failed to send daily report", "error", err);
    }
});
